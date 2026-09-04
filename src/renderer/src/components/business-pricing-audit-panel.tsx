"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  applyBusinessPriceWriteStatusToAuditSnapshot,
  applyBusinessPricingListingReadToAuditSnapshot,
  applyVerifiedBusinessPricingListingToAuditSnapshot,
  applyVerifiedBusinessPriceToAuditSnapshot,
  businessPricingRowConfigurationState,
  businessPricingWorkflowProgress,
  businessPricingRowMatchesFilter,
  isBusinessPricingRowCorrectlyConfigured,
  parseBusinessPriceUpdate,
  parseBusinessPriceValidation,
  parseBusinessPriceWriteStatus,
  parseBusinessPricingAuditSnapshot,
  parseBusinessPricingListingSnapshot,
  retainBusinessPricingWorkflowActivities,
  type BusinessPricingAuditFilter,
  type BusinessPricingAuditRow,
  type BusinessPricingAuditSnapshot,
  type BusinessPricingListingSnapshot,
  type BusinessPricingMoney,
  type BusinessPriceUpdate,
  type BusinessPriceWriteStatus,
  type BusinessQuantityDiscountPlan,
  type BusinessPricingWorkflowProgress,
  type BusinessPriceValidation,
} from "../business-pricing-audit";
import { RECOMMENDED_BUSINESS_PRICING_CONFIGURATION_LABELS } from
  "../../../shared/business-pricing-recommendations";
import {
  pollStandaloneAuditJob,
  standaloneAuditSnapshotMatchesJob,
  startStandaloneAuditJob,
  type StandaloneAuditJob,
  type StandaloneAuditMode,
} from "../standalone-audit";
import {
  openSellerCentralInventoryHandoff,
  supportsFixedSellerCentralHandoffs,
} from "../seller-central-handoff";
import { auditExportFilename } from "../audit-export-filename";
import {
  createRendererIdempotencyKey,
  publicProblemMessage,
} from "../write-request";
import AuditDetailsDisclosure from "./audit-details-disclosure";
import type { AuditSurfacePresentation } from "./audit-workspace-shell";
import BusinessPricingEditor from "./business-pricing-editor";

const FILTERS: readonly Readonly<{
  value: BusinessPricingAuditFilter;
  label: string;
}>[] = [
  { value: "all", label: "全部" },
  { value: "problem", label: "需處理" },
  { value: "missing", label: "未設定" },
  { value: "configured", label: "正確設定" },
  { value: "incomplete", label: "資料未完成" },
];

const RECOMMENDED_QUANTITY_DISCOUNT_TIERS = Object.freeze([
  Object.freeze({ lowerBound: 5, percent: 5 }),
  Object.freeze({ lowerBound: 10, percent: 10 }),
  Object.freeze({ lowerBound: 15, percent: 15 }),
  Object.freeze({ lowerBound: 20, percent: 20 }),
]);

const BUSINESS_PRICING_BATCH_OBSERVATION_DELAYS_MS = Object.freeze([
  0,
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
]);

type BusinessPricingBatchPreviewRow = Readonly<{
  sellerSku: string;
  stage: "minimum_price" | "business_price";
  validation: BusinessPriceValidation;
}>;

type BusinessPricingBatchPreview = Readonly<{
  previewId: string;
  rows: readonly BusinessPricingBatchPreviewRow[];
}>;

type BusinessPricingBatchResultRow = Readonly<{
  sellerSku: string;
  stage: "minimum_price" | "business_price";
  state:
    | "processing"
    | "verified"
    | "simulated"
    | "rejected"
    | "unknown"
    | "not-started";
  validation: BusinessPriceValidation;
  evidence:
    | Readonly<{
        kind: "write-status";
        value: BusinessPriceWriteStatus;
      }>
    | Readonly<{
        kind: "simulation";
        acceptedAt: string;
        requestId: string | null;
        submissionId: string | null;
        issues: readonly Readonly<{ severity: string; message: string }>[];
        notice: string;
      }>
    | null;
  error: Readonly<{
    code: string;
    message: string;
    requestId: string | null;
  }> | null;
}>;

type BusinessPricingBatchResult = Readonly<{
  status: "PROCESSING" | "COMPLETED" | "COMPLETED_WITH_ISSUES";
  rows: readonly BusinessPricingBatchResultRow[];
  acceptedCount: number;
  verifiedCount: number;
  issueCount: number;
  verified: boolean;
  canResend: false;
  notice: string;
}>;

function batchRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("B2B 批次回應無法安全辨識。");
  }
  return value as Record<string, unknown>;
}

function batchText(value: unknown, label: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > maximum ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(`B2B 批次的${label}無法安全辨識。`);
  }
  return value;
}

function batchStage(value: unknown): BusinessPricingBatchPreviewRow["stage"] {
  if (value !== "minimum_price" && value !== "business_price") {
    throw new Error("B2B 批次的處理階段無法安全辨識。");
  }
  return value;
}

function assertExactBatchSellerSkus(
  rows: readonly Readonly<{ sellerSku: string }>[],
  expectedSellerSkus: readonly string[],
): void {
  const actual = rows.map((row) => row.sellerSku);
  if (
    actual.length !== expectedSellerSkus.length ||
    new Set(actual).size !== actual.length ||
    actual.some((sellerSku, index) => sellerSku !== expectedSellerSkus[index])
  ) {
    throw new Error("B2B 批次回應與目前勾選的 Seller SKU 不一致。");
  }
}

function sameBatchMoney(
  left: BusinessPricingMoney | null,
  right: BusinessPricingMoney | null,
): boolean {
  return left === null
    ? right === null
    : right !== null &&
      left.amount === right.amount &&
      left.currencyCode === right.currencyCode;
}

function sameBatchQuantityDiscountPlan(
  left: BusinessQuantityDiscountPlan | null,
  right: BusinessQuantityDiscountPlan | null,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function expectedBatchQuantityDiscountPlan(
  row: BusinessPricingAuditRow,
): BusinessQuantityDiscountPlan {
  if (
    row.quantityDiscountPlanPresence === "duplicate" &&
    row.quantityDiscountPlan?.discountType === "percent"
  ) return row.quantityDiscountPlan;
  return {
    discountType: "percent",
    levels: RECOMMENDED_QUANTITY_DISCOUNT_TIERS.map((tier) => ({
      lowerBound: tier.lowerBound,
      value: tier.percent,
    })),
  };
}

function parseBusinessPricingBatchPreview(
  value: unknown,
  expectedRows: readonly BusinessPricingAuditRow[],
  expectedMode: StandaloneAuditMode,
  expectedMarketplaceId: string,
): BusinessPricingBatchPreview {
  const source = batchRecord(value);
  if (
    source.status !== "READY" ||
    source.marketplaceId !== expectedMarketplaceId ||
    !Array.isArray(source.rows)
  ) {
    throw new Error("B2B 批次預檢尚未準備完成。");
  }
  const rows = source.rows.map((value) => {
    const row = batchRecord(value);
    const sellerSku = batchText(row.sellerSku, "Seller SKU", 40);
    const stage = batchStage(row.stage);
    const validation = parseBusinessPriceValidation(row.validation);
    const expected = expectedRows.find((candidate) =>
      candidate.sellerSku === sellerSku
    );
    const requestedBusinessPrice = expected
      ? recommendedBusinessPrice(expected.standardPrice)
      : null;
    if (
      !expected ||
      !requestedBusinessPrice ||
      validation.mode !== expectedMode ||
      validation.marketplaceId !== expectedMarketplaceId ||
      validation.sellerSku !== sellerSku ||
      validation.asin !== expected.asin ||
      validation.productType !== expected.productType ||
      !sameBatchMoney(validation.standardPrice, expected.standardPrice) ||
      !sameBatchMoney(
        validation.previousBusinessPrice,
        expected.businessPrice,
      ) ||
      !sameBatchMoney(
        validation.requestedBusinessPrice,
        requestedBusinessPrice,
      ) ||
      validation.quantityDiscountPlanPresence !==
        expected.quantityDiscountPlanPresence ||
      !sameBatchQuantityDiscountPlan(
        validation.previousQuantityDiscountPlan,
        expected.quantityDiscountPlan,
      ) ||
      !sameBatchQuantityDiscountPlan(
        validation.requestedQuantityDiscountPlan,
        expectedBatchQuantityDiscountPlan(expected),
      ) ||
      stage !== (validation.minimumPriceChange === "lower"
        ? "minimum_price"
        : "business_price")
    ) {
      throw new Error(
        `B2B 批次 SKU ${sellerSku} 的 Validation Preview 綁定不一致。`,
      );
    }
    return {
      sellerSku,
      stage,
      validation,
    };
  });
  assertExactBatchSellerSkus(
    rows,
    expectedRows.map((row) => row.sellerSku),
  );
  return {
    previewId: batchText(source.previewId, "previewId", 256),
    rows,
  };
}

function batchOptionalText(
  value: unknown,
  label: string,
  maximum: number,
): string | null {
  return value === null || value === undefined
    ? null
    : batchText(value, label, maximum);
}

function batchTimestamp(value: unknown, label: string): string {
  const parsed = batchText(value, label, 40);
  if (!Number.isFinite(Date.parse(parsed))) {
    throw new Error(`B2B 批次的${label}無法安全辨識。`);
  }
  return parsed;
}

function batchCount(value: unknown, label: string, maximum: number): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < 0 ||
    Number(value) > maximum
  ) {
    throw new Error(`B2B 批次的${label}無法安全辨識。`);
  }
  return Number(value);
}

function waitForBatchObservation(
  delayMs: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }
  if (delayMs === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    const abort = () => {
      globalThis.clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

function parseBatchIssues(
  value: unknown,
): readonly Readonly<{ severity: string; message: string }>[] {
  if (!Array.isArray(value) || value.length > 100) {
    throw new Error("B2B 批次的 Amazon issues 無法安全辨識。");
  }
  return value.map((entry) => {
    const issue = batchRecord(entry);
    return {
      severity: batchText(issue.severity, "issue severity", 40),
      message: batchText(issue.message, "issue message", 4_000),
    };
  });
}

function submittedBatchPreview(validation: BusinessPriceValidation) {
  return {
    validation,
    body: {
      marketplaceId: validation.marketplaceId,
      sellerSku: validation.sellerSku,
      expectedStandardPrice: validation.standardPrice.amount,
      expectedBusinessPrice: validation.previousBusinessPrice?.amount ?? null,
      newBusinessPrice: validation.requestedBusinessPrice.amount,
      idempotencyKey: "batch-result-evidence",
    },
  } as const;
}

function parseMinimumPriceSimulation(
  value: unknown,
  validation: BusinessPriceValidation,
): BusinessPricingBatchResultRow["evidence"] {
  const source = batchRecord(value);
  const sameExactValue = (actual: unknown, expected: unknown): boolean =>
    JSON.stringify(actual) === JSON.stringify(expected);
  if (
    validation.mode !== "demo" ||
    validation.minimumPriceChange !== "lower" ||
    source.mode !== "demo" ||
    source.status !== "SIMULATED" ||
    source.marketplaceId !== validation.marketplaceId ||
    source.sellerSku !== validation.sellerSku ||
    source.asin !== validation.asin ||
    source.productType !== validation.productType ||
    !sameExactValue(source.standardPrice, validation.standardPrice) ||
    !sameExactValue(
      source.previousBusinessPrice,
      validation.previousBusinessPrice,
    ) ||
    !sameExactValue(
      source.previousMinimumPrice,
      validation.previousMinimumPrice,
    ) ||
    !sameExactValue(
      source.requestedMinimumPrice,
      validation.requestedMinimumPrice,
    ) ||
    !sameExactValue(
      source.lowestTierUnitPrice,
      validation.lowestTierUnitPrice,
    ) ||
    !sameExactValue(
      source.previousQuantityDiscountPlan,
      validation.previousQuantityDiscountPlan,
    ) ||
    source.previousQuantityDiscountPlanHash !==
      validation.previousQuantityDiscountPlanHash ||
    source.minimumPriceProtectedHash !==
      validation.minimumPriceProtectedHash ||
    source.minimumPriceCanonicalPatchHash !==
      validation.minimumPriceCanonicalPatchHash
  ) {
    throw new Error(
      `B2B 批次 SKU ${validation.sellerSku} 的模擬結果與預檢不一致。`,
    );
  }
  return {
    kind: "simulation",
    acceptedAt: batchTimestamp(source.acceptedAt, "模擬完成時間"),
    requestId: batchOptionalText(source.requestId, "Request ID", 512),
    submissionId: batchOptionalText(
      source.submissionId,
      "Submission ID",
      512,
    ),
    issues: parseBatchIssues(source.issues),
    notice: batchText(source.notice, "模擬結果說明", 4_000),
  };
}

function assertBatchWriteStatusBinding(
  status: BusinessPriceWriteStatus,
  preview: BusinessPricingBatchPreviewRow,
  expectedMode: StandaloneAuditMode,
  expectedMarketplaceId: string,
): void {
  const validation = preview.validation;
  if (
    expectedMode !== "live" ||
    status.marketplaceId !== expectedMarketplaceId ||
    status.sellerSku !== preview.sellerSku ||
    status.asin !== validation.asin ||
    status.productType !== validation.productType ||
    status.stage !== preview.stage ||
    !sameBatchMoney(
      status.previousBusinessPrice,
      validation.previousBusinessPrice,
    ) ||
    !sameBatchMoney(
      status.requestedBusinessPrice,
      validation.requestedBusinessPrice,
    ) ||
    !sameBatchMoney(
      status.previousMinimumPrice,
      validation.previousMinimumPrice,
    ) ||
    !sameBatchMoney(
      status.requestedMinimumPrice,
      validation.requestedMinimumPrice,
    ) ||
    !sameBatchMoney(
      status.lowestTierUnitPrice,
      validation.lowestTierUnitPrice,
    ) ||
    !sameBatchQuantityDiscountPlan(
      status.previousQuantityDiscountPlan,
      validation.previousQuantityDiscountPlan,
    ) ||
    !sameBatchQuantityDiscountPlan(
      status.requestedQuantityDiscountPlan,
      validation.requestedQuantityDiscountPlan,
    ) ||
    status.quantityDiscountPlanChange !==
      validation.quantityDiscountPlanChange
  ) {
    throw new Error(
      `B2B 批次 SKU ${preview.sellerSku} 的正式結果與預檢不一致。`,
    );
  }
}

function parseBatchError(value: unknown): BusinessPricingBatchResultRow["error"] {
  if (value === null) return null;
  const source = batchRecord(value);
  return {
    code: batchText(source.code, "錯誤代碼", 120),
    message: batchText(source.message, "錯誤說明", 4_000),
    requestId: batchOptionalText(source.requestId, "錯誤 Request ID", 512),
  };
}

function parseBusinessPricingBatchResult(
  value: unknown,
  preview: BusinessPricingBatchPreview,
  expectedMode: StandaloneAuditMode,
  expectedMarketplaceId: string,
): BusinessPricingBatchResult {
  const source = batchRecord(value);
  if (
    source.status !== "PROCESSING" &&
    source.status !== "COMPLETED" &&
    source.status !== "COMPLETED_WITH_ISSUES"
  ) {
    throw new Error("B2B 批次送出狀態無法安全辨識。");
  }
  if (!Array.isArray(source.rows)) {
    throw new Error("B2B 批次送出結果無法安全辨識。");
  }
  const rows = source.rows.map((value) => {
    const row = batchRecord(value);
    if (
      row.state !== "processing" &&
      row.state !== "verified" &&
      row.state !== "simulated" &&
      row.state !== "rejected" &&
      row.state !== "unknown" &&
      row.state !== "not-started"
    ) {
      throw new Error("B2B 批次的商品狀態無法安全辨識。");
    }
    const state = row.state as BusinessPricingBatchResultRow["state"];
    const sellerSku = batchText(row.sellerSku, "Seller SKU", 40);
    const stage = batchStage(row.stage);
    const previewRow = preview.rows.find((candidate) =>
      candidate.sellerSku === sellerSku
    );
    if (!previewRow || previewRow.stage !== stage) {
      throw new Error("B2B 批次正式結果與 Validation Preview 不一致。");
    }
    const error = parseBatchError(row.error);
    let evidence: BusinessPricingBatchResultRow["evidence"] = null;
    if (state === "processing" || state === "verified") {
      if (error !== null) {
        throw new Error("B2B 批次正式結果同時包含成功與錯誤證據。");
      }
      const status = parseBusinessPriceWriteStatus(row.result);
      if (
        status.status !== (state === "verified" ? "VERIFIED" : "PROCESSING")
      ) {
        throw new Error("B2B 批次正式結果與回查狀態不一致。");
      }
      assertBatchWriteStatusBinding(
        status,
        previewRow,
        expectedMode,
        expectedMarketplaceId,
      );
      evidence = { kind: "write-status", value: status };
    } else if (state === "simulated") {
      if (error !== null) {
        throw new Error("B2B 批次模擬結果同時包含錯誤證據。");
      }
      if (previewRow.stage === "business_price") {
        const result: BusinessPriceUpdate = parseBusinessPriceUpdate(
          row.result,
          submittedBatchPreview(previewRow.validation),
        );
        if (result.mode !== "demo" || result.status !== "SIMULATED") {
          throw new Error("B2B 批次模擬結果無法安全辨識。");
        }
        evidence = {
          kind: "simulation",
          acceptedAt: result.acceptedAt,
          requestId: null,
          submissionId: null,
          issues: result.issues,
          notice: result.notice,
        };
      } else {
        evidence = parseMinimumPriceSimulation(
          row.result,
          previewRow.validation,
        );
      }
    } else if (row.result !== null || error === null) {
      throw new Error("B2B 批次未送出列缺少可安全辨識的錯誤證據。");
    }
    return {
      sellerSku,
      stage,
      state,
      validation: previewRow.validation,
      evidence,
      error,
    };
  });
  assertExactBatchSellerSkus(
    rows,
    preview.rows.map((row) => row.sellerSku),
  );
  const acceptedCount = batchCount(
    source.acceptedCount,
    "Amazon 接受數",
    rows.length,
  );
  const verifiedCount = batchCount(
    source.verifiedCount,
    "Amazon 回查完成數",
    rows.length,
  );
  const issueCount = batchCount(source.issueCount, "問題數", rows.length);
  const actualAcceptedCount = rows.filter((row) =>
    row.state === "processing" || row.state === "verified"
  ).length;
  const actualVerifiedCount = rows.filter((row) =>
    row.state === "verified"
  ).length;
  const actualIssueCount = rows.filter((row) =>
    row.state === "rejected" ||
    row.state === "unknown" ||
    row.state === "not-started"
  ).length;
  const actualVerified = rows.length > 0 && rows.every((row) =>
    row.state === "verified" || row.state === "simulated"
  );
  const expectedStatus = actualIssueCount > 0
    ? "COMPLETED_WITH_ISSUES"
    : rows.some((row) => row.state === "processing")
      ? "PROCESSING"
      : "COMPLETED";
  if (
    source.previewId !== preview.previewId ||
    source.marketplaceId !== expectedMarketplaceId ||
    source.canResend !== false ||
    typeof source.verified !== "boolean" ||
    acceptedCount !== actualAcceptedCount ||
    verifiedCount !== actualVerifiedCount ||
    issueCount !== actualIssueCount ||
    source.verified !== actualVerified ||
    source.status !== expectedStatus
  ) {
    throw new Error("B2B 批次正式結果綁定無法安全辨識。");
  }
  return {
    status: source.status,
    rows,
    acceptedCount,
    verifiedCount,
    issueCount,
    verified: source.verified,
    canResend: false,
    notice: batchText(source.notice, "結果說明", 4_000),
  };
}

function batchStageLabel(
  stage: BusinessPricingBatchPreviewRow["stage"],
): string {
  return stage === "minimum_price"
    ? "需先調整最低價"
    : "B2B 價格與階梯折扣";
}

function batchResultStateLabel(
  state: BusinessPricingBatchResultRow["state"],
): string {
  if (state === "processing") return "Amazon 處理中";
  if (state === "verified") return "Amazon 回查完成";
  if (state === "simulated") return "模擬完成";
  if (state === "rejected") return "未送出";
  if (state === "not-started") return "前筆結果不明，本列未送出";
  return "結果待確認，禁止重送";
}

function formatMoney(value: BusinessPricingMoney | null): string {
  if (!value) return "—";
  try {
    return new Intl.NumberFormat("zh-TW", {
      style: "currency",
      currency: value.currencyCode,
      maximumFractionDigits: value.currencyCode === "JPY" ? 0 : 2,
    }).format(value.amount);
  } catch {
    return `${value.currencyCode} ${value.amount}`;
  }
}

function statusLabel(row: BusinessPricingAuditRow): string {
  if (row.status === "configured") {
    return RECOMMENDED_BUSINESS_PRICING_CONFIGURATION_LABELS[
      businessPricingRowConfigurationState(row)
    ];
  }
  if (row.status === "above_standard") return "B2B 高於一般售價";
  if (row.status === "missing") return "未設定 B2B 價格";
  if (row.status === "unsupported") return "請至 Amazon 後台確認";
  return "資料未完成";
}

function rowStatusDetail(row: BusinessPricingAuditRow): string {
  if (row.status === "incomplete") {
    return row.reason;
  }
  if (row.status === "unsupported") {
    return "請至 Amazon 後台核對 Business Price 與數量折扣。";
  }
  if (row.status === "above_standard") {
    return "目前 B2B 價格高於一般售價，建議調整。";
  }
  if (row.status === "missing") {
    return "Amazon Business 可用，但尚未設定 B2B 價格。";
  }
  if (
    row.recommendedPriceMismatch ||
    row.recommendedQuantityDiscountMismatch
  ) {
    return "已找到 Amazon Business 價格，但仍有建議規則需要調整。";
  }
  if (!isBusinessPricingRowCorrectlyConfigured(row)) return row.reason;
  return "Business Price 與建議數量折扣皆已正確設定。";
}

function recommendationFindings(row: BusinessPricingAuditRow): string[] {
  return [
    ...(row.recommendedPriceMismatch ? ["不符建議 B2B 價格"] : []),
    ...(row.recommendedQuantityDiscountMismatch
      ? ["未正確設定階梯折扣"]
      : []),
  ];
}

function QuantityDiscountPlan({
  plan,
  ambiguous = false,
}: Readonly<{
  plan: BusinessQuantityDiscountPlan | null;
  ambiguous?: boolean;
}>) {
  if (ambiguous) {
    return <span className="business-pricing-quantity-empty">Amazon 未能確認，請到後台核對</span>;
  }
  if (!plan) {
    return <span className="business-pricing-quantity-empty">未設定</span>;
  }
  const percent = plan.discountType === "percent";
  return (
    <div className="business-pricing-quantity-plan">
      <span className="business-pricing-quantity-kind">
        {percent ? "百分比折扣" : "固定單價"}
      </span>
      <div
        className="business-pricing-quantity-tiers"
        role="list"
        aria-label={percent ? "百分比數量折扣階梯" : "固定單價數量折扣階梯"}
      >
        {plan.levels.map((level) => (
          <span
            className="business-pricing-quantity-tier"
            role="listitem"
            key={`${level.lowerBound}-${level.value}`}
          >
            <strong>{level.lowerBound} 件以上</strong>
            <span>{percent ? `省 ${level.value}%` : `每件 ${level.value}`}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function BatchValidationDiff({
  validation,
}: Readonly<{ validation: BusinessPriceValidation }>) {
  const minimumPricePreserved = validation.minimumPriceChange === "preserve";
  const quantityDiscountsPreserved =
    validation.quantityDiscountPlanChange === "preserve";
  return (
    <div
      className="business-pricing-batch-validation"
      aria-label={`${validation.sellerSku} Amazon Validation Preview 完整差異`}
    >
      <dl className="business-pricing-batch-diff-grid">
        <div>
          <dt>送出前一般售價</dt>
          <dd>{formatMoney(validation.standardPrice)}</dd>
        </div>
        <div>
          <dt>目前 B2B 價格</dt>
          <dd className="business-pricing-batch-old-value">
            {formatMoney(validation.previousBusinessPrice)}
          </dd>
        </div>
        <div>
          <dt>建議 B2B 價格</dt>
          <dd className="business-pricing-batch-new-value">
            {formatMoney(validation.requestedBusinessPrice)}
          </dd>
        </div>
        <div>
          <dt>最低允許售價</dt>
          <dd>
            {minimumPricePreserved
              ? <>保留 {formatMoney(validation.previousMinimumPrice)}</>
              : <>
                  <span className="business-pricing-batch-old-value">
                    {formatMoney(validation.previousMinimumPrice)}
                  </span>
                  <span aria-hidden="true"> → </span>
                  <span className="business-pricing-batch-new-value">
                    {formatMoney(validation.requestedMinimumPrice)}
                  </span>
                </>}
          </dd>
        </div>
        <div className="business-pricing-batch-quantity-diff">
          <dt>目前數量折扣</dt>
          <dd>
            <QuantityDiscountPlan
              plan={validation.previousQuantityDiscountPlan}
              ambiguous={validation.quantityDiscountPlanPresence === "ambiguous"}
            />
          </dd>
        </div>
        <div className="business-pricing-batch-quantity-diff">
          <dt>更新後數量折扣</dt>
          <dd>
            {quantityDiscountsPreserved && (
              <span className="business-pricing-batch-preserved">完整保留</span>
            )}
            <QuantityDiscountPlan
              plan={validation.requestedQuantityDiscountPlan}
            />
          </dd>
        </div>
      </dl>
      <div className="business-pricing-batch-issues">
        <strong>Amazon Validation Preview 提醒</strong>
        {validation.issues.length > 0
          ? (
              <ul>
                {validation.issues.map((issue, index) => (
                  <li key={`${issue.severity}-${index}`}>
                    <span>{issue.severity}</span>
                    <p>{issue.message}</p>
                  </li>
                ))}
              </ul>
            )
          : <p>沒有 Amazon 提醒。</p>}
      </div>
    </div>
  );
}

function BatchResultEvidence({
  row,
}: Readonly<{ row: BusinessPricingBatchResultRow }>) {
  const evidence = row.evidence;
  return (
    <div className="business-pricing-batch-result-evidence">
      <BatchValidationDiff validation={row.validation} />
      {evidence?.kind === "write-status" && (
        <>
          <dl className="business-pricing-batch-evidence-grid">
            <div>
              <dt>Amazon 接受時間</dt>
              <dd>{evidence.value.acceptedAt}</dd>
            </div>
            <div>
              <dt>Request ID</dt>
              <dd>{evidence.value.requestId ?? "—"}</dd>
            </div>
            <div>
              <dt>Submission ID</dt>
              <dd>{evidence.value.submissionId ?? "—"}</dd>
            </div>
            <div>
              <dt>Amazon 回查完成時間</dt>
              <dd>{evidence.value.verifiedAt ?? "尚未完成"}</dd>
            </div>
            <div>
              <dt>重送狀態</dt>
              <dd>canResend: false（禁止重送）</dd>
            </div>
          </dl>
          <p>{evidence.value.notice}</p>
        </>
      )}
      {evidence?.kind === "simulation" && (
        <>
          <dl className="business-pricing-batch-evidence-grid">
            <div>
              <dt>模擬完成時間</dt>
              <dd>{evidence.acceptedAt}</dd>
            </div>
            <div>
              <dt>Request ID</dt>
              <dd>{evidence.requestId ?? "—"}</dd>
            </div>
            <div>
              <dt>Submission ID</dt>
              <dd>{evidence.submissionId ?? "—"}</dd>
            </div>
            <div>
              <dt>重送狀態</dt>
              <dd>canResend: false（禁止重送）</dd>
            </div>
          </dl>
          <p>{evidence.notice}</p>
          {evidence.issues.length > 0 && (
            <ul className="business-pricing-batch-result-issues">
              {evidence.issues.map((issue, index) => (
                <li key={`${issue.severity}-${index}`}>
                  <strong>{issue.severity}</strong>
                  <span>{issue.message}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {row.error && (
        <dl className="business-pricing-batch-error-evidence">
          <div>
            <dt>錯誤代碼</dt>
            <dd>{row.error.code}</dd>
          </div>
          <div>
            <dt>錯誤說明</dt>
            <dd>{row.error.message}</dd>
          </div>
          <div>
            <dt>Request ID</dt>
            <dd>{row.error.requestId ?? "—"}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}

function WorkflowProgress({
  progress,
}: Readonly<{ progress: BusinessPricingWorkflowProgress }>) {
  const stateLabel = (state: BusinessPricingWorkflowProgress["steps"][number]["state"]): string => {
    if (state === "complete") return "完成";
    if (state === "current") return "目前步驟";
    if (state === "skipped") return "本次不需要";
    return "尚未開始";
  };
  return (
    <div
      className={`business-pricing-workflow is-${progress.state.replace("_", "-")}`}
      aria-label={`B2B 調整進度：${progress.headline}`}
    >
      <header>
        <strong>{progress.headline}</strong>
        <span>已調整商品</span>
      </header>
      <ol>
        {progress.steps.map((step, index) => (
          <li className={`is-${step.state}`} key={step.label}>
            <i aria-hidden="true">{step.state === "complete"
              ? "✓"
              : step.state === "current"
              ? index + 1
              : "–"}</i>
            <span>{step.label}</span>
            <small>{step.statusLabel ?? stateLabel(step.state)}</small>
            {(step.target || step.observed) && (
              <span className="business-pricing-workflow-values">
                {step.target && <em>目標 {formatMoney(step.target)}</em>}
                {step.observed && (
                  <em>Amazon 回查 {formatMoney(step.observed)}</em>
                )}
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function recommendedBusinessPrice(
  standardPrice: BusinessPricingMoney | null,
): BusinessPricingMoney | null {
  if (!standardPrice || standardPrice.currencyCode !== "USD" ||
      standardPrice.amount <= 1) return null;
  return {
    amount: Number((standardPrice.amount - 1).toFixed(2)),
    currencyCode: "USD",
  };
}

function rowCount(
  snapshot: BusinessPricingAuditSnapshot,
  filter: BusinessPricingAuditFilter,
): number {
  return snapshot.rows.filter((row) =>
    businessPricingRowMatchesFilter(row, filter),
  ).length;
}

export function shouldResumeBusinessPricingAuditJob(input: Readonly<{
  initialJob: StandaloneAuditJob | null;
  snapshot: BusinessPricingAuditSnapshot | null;
  marketplaceId: string;
  mode: StandaloneAuditMode;
  observerJobId: string | null;
}>): boolean {
  const { initialJob } = input;
  if (
    !initialJob ||
    initialJob.kind !== "businessPricing" ||
    initialJob.marketplaceId !== input.marketplaceId ||
    initialJob.mode !== input.mode ||
    (!initialJob.ready && input.observerJobId === initialJob.jobId)
  ) return false;
  return !standaloneAuditSnapshotMatchesJob(input.snapshot, initialJob);
}

export default function BusinessPricingAuditPanel({
  marketplaceId,
  marketplaceShort,
  mode = "live",
  presentation = "dialog",
  initialSnapshot = null,
  cachedSnapshot = null,
  initialJob = null,
  onSnapshotChange,
  onJobChange,
  onEditorOpenChange,
  onEditorBusyChange,
  onBatchBusyChange,
}: {
  marketplaceId: string;
  marketplaceShort: string;
  mode?: StandaloneAuditMode;
  presentation?: AuditSurfacePresentation;
  initialSnapshot?: BusinessPricingAuditSnapshot | null;
  cachedSnapshot?: BusinessPricingAuditSnapshot | null;
  initialJob?: StandaloneAuditJob | null;
  onSnapshotChange?: (snapshot: BusinessPricingAuditSnapshot) => void;
  onJobChange?: (job: StandaloneAuditJob) => void;
  onEditorOpenChange?: (open: boolean) => void;
  onEditorBusyChange?: (busy: boolean) => void;
  onBatchBusyChange?: (busy: boolean) => void;
}) {
  const [snapshot, setSnapshot] = useState<BusinessPricingAuditSnapshot | null>(
    initialSnapshot ?? cachedSnapshot,
  );
  const [filter, setFilter] = useState<BusinessPricingAuditFilter>("problem");
  const [skuQuery, setSkuQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [selected, setSelected] =
    useState<BusinessPricingListingSnapshot | null>(null);
  const [batchSelectedSellerSkus, setBatchSelectedSellerSkus] =
    useState<ReadonlySet<string>>(() => new Set());
  const [batchPreview, setBatchPreview] =
    useState<BusinessPricingBatchPreview | null>(null);
  const [batchResult, setBatchResult] =
    useState<BusinessPricingBatchResult | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [batchObservationMessage, setBatchObservationMessage] =
    useState<string | null>(null);
  const [batchPreviewing, setBatchPreviewing] = useState(false);
  const [batchCommitting, setBatchCommitting] = useState(false);
  const [batchLockedSellerSkus, setBatchLockedSellerSkus] =
    useState<ReadonlySet<string>>(() => new Set());
  const [editLoading, setEditLoading] = useState(false);
  const [openingSellerSku, setOpeningSellerSku] = useState<string | null>(null);
  const [job, setJob] = useState<StandaloneAuditJob | null>(
    initialJob?.kind === "businessPricing" &&
      initialJob.marketplaceId === marketplaceId &&
      initialJob.mode === mode
      ? initialJob
      : null,
  );
  const abortRef = useRef<AbortController | null>(null);
  const batchObservationAbortRef = useRef<AbortController | null>(null);
  const observerJobIdRef = useRef<string | null>(null);
  const editorRevisionRef = useRef(0);
  const panelRef = useRef<HTMLElement | null>(null);
  const auditScrollTopRef = useRef(0);
  const batchSelectAllRef = useRef<HTMLInputElement | null>(null);
  const editorOpenRef = useRef(false);
  const snapshotRef = useRef<BusinessPricingAuditSnapshot | null>(snapshot);

  const publishSnapshot = (next: BusinessPricingAuditSnapshot) => {
    snapshotRef.current = next;
    setSnapshot(next);
    onSnapshotChange?.(next);
  };

  const rememberWriteStatus = (writeStatus: BusinessPriceWriteStatus) => {
    const current = snapshotRef.current;
    if (!current) return;
    publishSnapshot(applyBusinessPriceWriteStatusToAuditSnapshot(
      current,
      writeStatus,
    ));
  };

  const publishBatchResult = (next: BusinessPricingBatchResult) => {
    for (const row of next.rows) {
      if (row.evidence?.kind === "write-status") {
        rememberWriteStatus(row.evidence.value);
      }
    }
    setBatchResult(next);
    setBatchLockedSellerSkus((current) => {
      const locked = new Set(current);
      for (const row of next.rows) {
        if (row.state === "processing" || row.state === "unknown") {
          locked.add(row.sellerSku);
        } else {
          locked.delete(row.sellerSku);
        }
      }
      return locked;
    });
  };

  const rememberListingRead = (listing: BusinessPricingListingSnapshot) => {
    const current = snapshotRef.current;
    if (!current || !listing.writeStatus) return;
    publishSnapshot(applyBusinessPricingListingReadToAuditSnapshot(
      current,
      listing,
    ));
  };

  const visibleSnapshot = useMemo(() => {
    if (!snapshot || loading) return null;
    if (!job) return snapshot;
    if (!job.ready || job.status !== "completed") return null;
    const jobSnapshot = job.snapshot;
    return jobSnapshot && typeof jobSnapshot === "object" &&
        !Array.isArray(jobSnapshot) &&
        (jobSnapshot as { fetchedAt?: unknown }).fetchedAt === snapshot.fetchedAt
      ? snapshot
      : null;
  }, [job, loading, snapshot]);
  const terminalJobError = job?.ready && job.status !== "completed"
    ? job.error.message
    : null;
  const batchAuditBinding = useMemo(() => {
    if (
      !job ||
      !visibleSnapshot ||
      job.kind !== "businessPricing" ||
      job.marketplaceId !== marketplaceId ||
      job.mode !== mode ||
      !job.ready ||
      job.status !== "completed" ||
      !standaloneAuditSnapshotMatchesJob(visibleSnapshot, job)
    ) return null;
    return { jobId: job.jobId, contextId: job.contextId } as const;
  }, [job, marketplaceId, mode, visibleSnapshot]);

  const fixedSellerCentralHandoffs = supportsFixedSellerCentralHandoffs(
    typeof window === "undefined" ? null : window.fbaOS?.app,
  );

  useEffect(() => () => {
    abortRef.current?.abort();
    batchObservationAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    onEditorOpenChange?.(selected !== null);
  }, [onEditorOpenChange, selected]);

  useEffect(() => {
    const editorOpen = selected !== null;
    if (editorOpenRef.current === editorOpen) return;
    editorOpenRef.current = editorOpen;
    const targetScrollTop = editorOpen ? 0 : auditScrollTopRef.current;
    if (presentation === "dialog") {
      const panel = panelRef.current;
      if (panel) panel.scrollTop = targetScrollTop;
      return;
    }

    let restoreFrame: number | null = null;
    let scrollRoot: HTMLElement | null = null;
    let previousScrollBehavior: string | null = null;
    try {
      scrollRoot = document.documentElement;
      previousScrollBehavior = scrollRoot.style.scrollBehavior;
      // The workspace presentation has no panel scroller: the browser window
      // owns the audit-list position. Disable global smooth scrolling for this
      // state restoration so the editor and the originating row land exactly.
      scrollRoot.style.scrollBehavior = "auto";
      window.scrollTo(0, targetScrollTop);
      restoreFrame = window.requestAnimationFrame(() => {
        if (scrollRoot && previousScrollBehavior !== null) {
          scrollRoot.style.scrollBehavior = previousScrollBehavior;
        }
        scrollRoot = null;
        previousScrollBehavior = null;
      });
    } catch {
      // Embedded test browsers may not implement scrolling.
    }
    return () => {
      if (restoreFrame !== null) window.cancelAnimationFrame(restoreFrame);
      if (scrollRoot && previousScrollBehavior !== null) {
        scrollRoot.style.scrollBehavior = previousScrollBehavior;
      }
    };
  }, [presentation, selected]);

  const visibleRows = useMemo(() => {
    if (!visibleSnapshot) return [];
    const normalizedSkuQuery = skuQuery.trim().toLocaleLowerCase("en-US");
    const activityOrder = new Map(
      (visibleSnapshot.workflowActivities ?? []).map((activity, index) => [
        activity.sellerSku,
        index,
      ]),
    );
    return visibleSnapshot.rows
      .filter((row) =>
        businessPricingRowMatchesFilter(row, filter) &&
        (!normalizedSkuQuery ||
          row.sellerSku.toLocaleLowerCase("en-US").includes(
            normalizedSkuQuery,
          ))
      )
      .map((row, index) => ({ row, index }))
      .sort((left, right) => {
        const leftActivity = activityOrder.get(left.row.sellerSku);
        const rightActivity = activityOrder.get(right.row.sellerSku);
        if (leftActivity === undefined && rightActivity === undefined) {
          return left.index - right.index;
        }
        if (leftActivity === undefined) return 1;
        if (rightActivity === undefined) return -1;
        return leftActivity - rightActivity;
      })
      .map(({ row }) => row);
  },
    [filter, skuQuery, visibleSnapshot],
  );

  const workflowActivities = visibleSnapshot?.workflowActivities ?? [];
  const processingSellerSkus = useMemo(() => new Set([
    ...workflowActivities
      .filter((activity) => activity.writeStatus.status === "PROCESSING")
      .map((activity) => activity.sellerSku),
    ...batchLockedSellerSkus,
  ]), [batchLockedSellerSkus, workflowActivities]);
  const eligibleVisibleRows = useMemo(() => visibleRows.filter((row) =>
    businessPricingRowMatchesFilter(row, "problem") &&
    !processingSellerSkus.has(row.sellerSku) &&
    recommendedBusinessPrice(row.standardPrice) !== null
  ), [processingSellerSkus, visibleRows]);
  const eligibleVisibleSellerSkuKey = eligibleVisibleRows
    .map((row) => row.sellerSku)
    .join("\u001f");
  const batchSelectedRows = eligibleVisibleRows.filter((row) =>
    batchSelectedSellerSkus.has(row.sellerSku)
  );
  const allEligibleVisibleSelected = eligibleVisibleRows.length > 0 &&
    batchSelectedRows.length === eligibleVisibleRows.length;
  const someEligibleVisibleSelected = batchSelectedRows.length > 0 &&
    !allEligibleVisibleSelected;
  const batchBusy = batchPreviewing || batchCommitting;

  useEffect(() => {
    onBatchBusyChange?.(batchBusy);
  }, [batchBusy, onBatchBusyChange]);

  useEffect(() => () => {
    onBatchBusyChange?.(false);
  }, [onBatchBusyChange]);

  useEffect(() => {
    const allowed = new Set(eligibleVisibleRows.map((row) => row.sellerSku));
    setBatchSelectedSellerSkus((current) => {
      const retained = [...current].filter((sellerSku) => allowed.has(sellerSku));
      if (retained.length === current.size) return current;
      return new Set(retained);
    });
    setBatchPreview(null);
    setBatchError(null);
  // The ordered key is the stable public selection surface for this effect.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligibleVisibleSellerSkuKey]);

  useEffect(() => {
    if (batchSelectAllRef.current) {
      batchSelectAllRef.current.indeterminate = someEligibleVisibleSelected;
    }
  }, [someEligibleVisibleSelected]);

  const workflowCounts = workflowActivities.reduce((counts, activity) => {
    const state = businessPricingWorkflowProgress(activity).state;
    counts[state] += 1;
    return counts;
  }, { waiting_amazon: 0, waiting_b2b: 0, complete: 0 });

  const loadAudit = async (
    completedJob: StandaloneAuditJob,
    signal: AbortSignal,
  ) => {
    if (!completedJob.ready || completedJob.status !== "completed") {
      throw new Error(
        completedJob.ready
          ? completedJob.error.message
          : "B2B 價格背景健檢尚未完成。",
      );
    }
    const next = parseBusinessPricingAuditSnapshot(completedJob.snapshot);
    if (next.marketplaceId !== marketplaceId) {
      throw new Error("B2B 價格健檢站點與目前選擇不一致。");
    }
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const previousActivities = snapshotRef.current?.workflowActivities ?? [];
    const retainedActivities = retainBusinessPricingWorkflowActivities(
      next,
      previousActivities,
    );
    publishSnapshot(retainedActivities.length > 0
      ? { ...next, workflowActivities: retainedActivities }
      : next);
    setFilter("problem");
    setProgress(null);
  };

  const runAudit = async () => {
    abortRef.current?.abort();
    batchObservationAbortRef.current?.abort();
    batchObservationAbortRef.current = null;
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    setSnapshot(null);
    setBatchSelectedSellerSkus(new Set());
    setBatchPreview(null);
    setBatchResult(null);
    setBatchError(null);
    setBatchObservationMessage(null);
    setBatchLockedSellerSkus(new Set());
    setProgress("正在建立 Amazon FBA 全商品清單…");
    editorRevisionRef.current += 1;
    setSelected(null);
    try {
      let current = await startStandaloneAuditJob({
        kind: "businessPricing",
        marketplaceId,
        mode,
        signal: controller.signal,
      });
      observerJobIdRef.current = current.jobId;
      setJob(current);
      onJobChange?.(current);
      setProgress(current.progress.message);
      current = await pollStandaloneAuditJob({
        expected: current,
        signal: controller.signal,
        onProgress: (next) => {
          setJob(next);
          onJobChange?.(next);
          setProgress(next.progress.message);
        },
      });
      setJob(current);
      onJobChange?.(current);
      await loadAudit(current, controller.signal);
      observerJobIdRef.current = null;
    } catch (requestError) {
      if (requestError instanceof Error && requestError.name === "AbortError") return;
      setError(requestError instanceof Error ? requestError.message : "B2B 價格健檢失敗。");
      setProgress(null);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        observerJobIdRef.current = null;
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!shouldResumeBusinessPricingAuditJob({
      initialJob,
      snapshot,
      marketplaceId,
      mode,
      observerJobId: observerJobIdRef.current,
    })) return;
    // The guard above proves this is a matching B2B job.
    const observedJob = initialJob!;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    observerJobIdRef.current = observedJob.jobId;
    setJob(observedJob);
    setLoading(true);
    setError(null);
    setProgress(observedJob.progress.message);
    void (async () => {
      try {
        const terminal = observedJob.ready
          ? observedJob
          : await pollStandaloneAuditJob({
              expected: observedJob,
              signal: controller.signal,
              onProgress: (next) => {
                setJob(next);
                onJobChange?.(next);
                setProgress(next.progress.message);
              },
            });
        setJob(terminal);
        onJobChange?.(terminal);
        await loadAudit(terminal, controller.signal);
      } catch (resumeError) {
        if (resumeError instanceof Error && resumeError.name === "AbortError") return;
        setError(resumeError instanceof Error
          ? resumeError.message
          : "目前無法接續 B2B 價格健檢。");
        setProgress(null);
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          observerJobIdRef.current = null;
          setLoading(false);
        }
      }
    })();
    return () => {
      controller.abort();
      if (abortRef.current === controller) {
        abortRef.current = null;
        observerJobIdRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    initialJob?.jobId,
    initialJob?.contextId,
    initialJob?.ready,
    marketplaceId,
    mode,
  ]);

  const openSellerCentralInventory = async (sellerSku: string) => {
    setHandoffError(null);
    try {
      const outcome = await openSellerCentralInventoryHandoff(
        window.fbaOS.app,
        sellerSku,
      );
      if (outcome === "upgrade-required") {
        setHandoffError(
          "目前 Notebook Key 版本無法安全開啟指定 SKU；請先更新 Notebook Key。為避免開錯商品，不會改開 Seller Central 首頁。",
        );
      }
    } catch {
      setHandoffError("無法開啟這個 SKU 的 Amazon 庫存頁；請更新 Notebook Key 後再試一次。");
    }
  };

  const openEditor = async (row: BusinessPricingAuditRow) => {
    auditScrollTopRef.current = presentation === "workspace"
      ? window.scrollY
      : panelRef.current?.scrollTop ?? 0;
    const revision = ++editorRevisionRef.current;
    setEditLoading(true);
    setOpeningSellerSku(row.sellerSku);
    setError(null);
    setSelected(null);
    try {
      const params = new URLSearchParams({
        marketplaceId,
        sku: row.sellerSku,
      });
      const response = await fetch(`/api/sp-api/business-pricing?${params}`, {
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(publicProblemMessage(
          payload,
          "無法重新讀取此 SKU 的 B2B 價格。",
        ));
      }
      const fresh = parseBusinessPricingListingSnapshot(payload);
      if (
        fresh.marketplaceId !== marketplaceId ||
        fresh.sellerSku !== row.sellerSku ||
        fresh.asin !== row.asin ||
        fresh.productType !== row.productType
      ) {
        throw new Error(
          "Amazon 商品身分已變更，請重新健檢後再開啟 B2B 價格編輯。",
        );
      }
      if (editorRevisionRef.current !== revision) return;
      if (fresh.writeStatus) rememberListingRead(fresh);
      setSelected(fresh);
    } catch (requestError) {
      if (editorRevisionRef.current === revision) {
        setError(requestError instanceof Error
          ? requestError.message
          : "無法開啟 B2B 價格編輯。");
      }
    } finally {
      if (editorRevisionRef.current === revision) {
        setEditLoading(false);
        setOpeningSellerSku(null);
      }
    }
  };

  const closeEditor = () => {
    if (editLoading) return;
    editorRevisionRef.current += 1;
    setSelected(null);
    setEditLoading(false);
    setOpeningSellerSku(null);
    onEditorBusyChange?.(false);
  };

  const applyVerifiedPrice = (nextResult: BusinessPriceUpdate) => {
    const current = snapshotRef.current;
    if (!current) return;
    const nextSnapshot = applyVerifiedBusinessPriceToAuditSnapshot(
      current,
      nextResult,
    );
    publishSnapshot(nextSnapshot);
  };

  const applyVerifiedListing = (
    nextListing: BusinessPricingListingSnapshot,
  ) => {
    const current = snapshotRef.current;
    if (!current) return;
    let nextSnapshot = applyVerifiedBusinessPricingListingToAuditSnapshot(
      current,
      nextListing,
    );
    if (nextListing.writeStatus) {
      nextSnapshot = applyBusinessPriceWriteStatusToAuditSnapshot(
        nextSnapshot,
        nextListing.writeStatus,
      );
    }
    publishSnapshot(nextSnapshot);
  };

  const updateBatchSelection = (sellerSku: string, checked: boolean) => {
    if (batchBusy) return;
    batchObservationAbortRef.current?.abort();
    batchObservationAbortRef.current = null;
    setBatchSelectedSellerSkus((current) => {
      const next = new Set(current);
      if (checked) next.add(sellerSku);
      else next.delete(sellerSku);
      return next;
    });
    setBatchPreview(null);
    setBatchResult(null);
    setBatchError(null);
    setBatchObservationMessage(null);
  };

  const updateVisibleBatchSelection = (checked: boolean) => {
    if (batchBusy) return;
    batchObservationAbortRef.current?.abort();
    batchObservationAbortRef.current = null;
    setBatchSelectedSellerSkus(checked
      ? new Set(eligibleVisibleRows.map((row) => row.sellerSku))
      : new Set());
    setBatchPreview(null);
    setBatchResult(null);
    setBatchError(null);
    setBatchObservationMessage(null);
  };

  const previewBusinessPricingBatch = async () => {
    if (batchBusy || batchSelectedRows.length === 0) return;
    if (!batchAuditBinding) {
      setBatchError("請先完成目前這次 B2B 全站健檢，再批次預檢勾選商品。");
      return;
    }
    const rows = [...batchSelectedRows];
    batchObservationAbortRef.current?.abort();
    batchObservationAbortRef.current = null;
    setBatchPreviewing(true);
    setBatchPreview(null);
    setBatchResult(null);
    setBatchError(null);
    setBatchObservationMessage(null);
    try {
      const items = rows.map((row) => {
        const recommendation = recommendedBusinessPrice(row.standardPrice);
        if (!row.standardPrice || !recommendation) {
          throw new Error(
            `${row.sellerSku} 無法建立可安全辨識的 B2B 建議。`,
          );
        }
        const quantityDiscountTiers =
          row.quantityDiscountPlanPresence === "duplicate" &&
            row.quantityDiscountPlan?.discountType === "percent"
            ? row.quantityDiscountPlan.levels.map((level) => ({
                lowerBound: level.lowerBound,
                percent: level.value,
              }))
            : RECOMMENDED_QUANTITY_DISCOUNT_TIERS;
        return {
          marketplaceId,
          sellerSku: row.sellerSku,
          expectedStandardPrice: row.standardPrice.amount,
          expectedBusinessPrice: row.businessPrice?.amount ?? null,
          newBusinessPrice: recommendation.amount,
          quantityDiscountTiers,
          idempotencyKey: createRendererIdempotencyKey(
            "business-price-batch",
          ),
        };
      });
      const response = await fetch("/api/sp-api/business-pricing/batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jobId: batchAuditBinding.jobId,
          contextId: batchAuditBinding.contextId,
          items,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(publicProblemMessage(
          payload,
          "B2B 批次預檢未完成。",
        ));
      }
      setBatchPreview(parseBusinessPricingBatchPreview(
        payload,
        rows,
        mode,
        marketplaceId,
      ));
    } catch (requestError) {
      setBatchError(requestError instanceof Error
        ? requestError.message
        : "B2B 批次預檢未完成。");
    } finally {
      setBatchPreviewing(false);
    }
  };

  const observeBusinessPricingBatch = async (
    preview: BusinessPricingBatchPreview,
    binding: Readonly<{ jobId: string; contextId: string }>,
    controller: AbortController,
  ) => {
    try {
      for (const delayMs of BUSINESS_PRICING_BATCH_OBSERVATION_DELAYS_MS) {
        await waitForBatchObservation(delayMs, controller.signal);
        const params = new URLSearchParams({
          marketplaceId,
          jobId: binding.jobId,
          contextId: binding.contextId,
          previewId: preview.previewId,
        });
        const response = await fetch(
          `/api/sp-api/business-pricing/batch?${params}`,
          {
            method: "GET",
            cache: "no-store",
            signal: controller.signal,
          },
        );
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(publicProblemMessage(
            payload,
            "目前無法唯讀回查 B2B 批次狀態。",
          ));
        }
        const result = parseBusinessPricingBatchResult(
          payload,
          preview,
          mode,
          marketplaceId,
        );
        if (batchObservationAbortRef.current !== controller) return;
        publishBatchResult(result);
        if (!result.rows.some((row) => row.state === "processing")) {
          setBatchObservationMessage(result.verified
            ? "已用 GET 唯讀回查完成；沒有重新送出 PATCH。"
            : "唯讀回查已結束；問題列未重送，請依列內證據處理。");
          return;
        }
      }
      if (batchObservationAbortRef.current === controller) {
        setBatchObservationMessage(
          "唯讀回查已達 10 分鐘上限；Amazon 已接受的 SKU 仍保持鎖定，禁止重送。請重新執行全站健檢確認最新狀態。",
        );
      }
    } catch (requestError) {
      if (requestError instanceof Error && requestError.name === "AbortError") {
        return;
      }
      if (batchObservationAbortRef.current === controller) {
        setBatchObservationMessage(
          `${requestError instanceof Error
            ? requestError.message
            : "目前無法唯讀回查 B2B 批次狀態。"} Amazon 已接受的 SKU 仍保持鎖定，禁止重送。`,
        );
      }
    } finally {
      if (batchObservationAbortRef.current === controller) {
        batchObservationAbortRef.current = null;
      }
    }
  };

  const commitBusinessPricingBatch = async () => {
    if (batchBusy || !batchPreview) return;
    if (!batchAuditBinding) {
      setBatchError("目前健檢工作已變更；請重新完成 B2B 全站健檢與批次預檢。");
      return;
    }
    const preview = batchPreview;
    const binding = batchAuditBinding;
    batchObservationAbortRef.current?.abort();
    batchObservationAbortRef.current = null;
    setBatchCommitting(true);
    setBatchError(null);
    setBatchObservationMessage(null);
    try {
      const response = await fetch("/api/sp-api/business-pricing/batch", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ previewId: preview.previewId }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(publicProblemMessage(
          payload,
          "B2B 批次送出未完成。",
        ));
      }
      const result = parseBusinessPricingBatchResult(
        payload,
        preview,
        mode,
        marketplaceId,
      );
      publishBatchResult(result);
      setBatchSelectedSellerSkus(new Set());
      if (result.rows.some((row) => row.state === "processing")) {
        const controller = new AbortController();
        batchObservationAbortRef.current = controller;
        void observeBusinessPricingBatch(preview, binding, controller);
      }
    } catch (requestError) {
      setBatchError(requestError instanceof Error
        ? requestError.message
        : "B2B 批次送出未完成。");
    } finally {
      setBatchCommitting(false);
    }
  };

  const exportExcel = async () => {
    if (
      !visibleSnapshot ||
      exporting ||
      !job?.ready ||
      job.status !== "completed"
    ) return;
    setExporting(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        marketplaceId,
        mode,
        jobId: job.jobId,
        contextId: job.contextId,
      });
      const response = await fetch(
        `/api/sp-api/business-pricing-audit/export?${params}`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        let message = "目前無法匯出 B2B 價格 Excel。";
        try {
          const payload = await response.json() as { message?: unknown };
          if (typeof payload.message === "string") message = payload.message;
        } catch {
          // The bytes endpoint may not have a JSON body.
        }
        throw new Error(message);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = auditExportFilename({
        kind: "businessPricing",
        marketplaceShort,
        fetchedAt: visibleSnapshot.fetchedAt,
      });
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(exportError instanceof Error
        ? exportError.message
        : "目前無法匯出 B2B 價格 Excel。");
    } finally {
      setExporting(false);
    }
  };

  return (
    <section
      ref={panelRef}
      className={`business-pricing-audit-panel ${
        selected ? "is-editor-view" : "is-audit-view"
      }`}
      data-business-pricing-view={selected ? "editor" : "audit"}
      aria-label={selected
        ? `${selected.sellerSku} B2B 價格編輯`
        : "全站 FBA Amazon Business 價格健檢"}
    >
      {selected ? (
        <div className="business-pricing-detail-view">
          <div className="business-pricing-detail-toolbar">
            <div>
              <span>安全調整 B2B 價格</span>
              <strong>{selected.sellerSku}</strong>
            </div>
          </div>
          <BusinessPricingEditor
            key={`${selected.sellerSku}-${selected.fetchedAt}`}
            listing={selected}
            onClose={closeEditor}
            onVerified={applyVerifiedPrice}
            onCanonicalListingVerified={applyVerifiedListing}
            onCanonicalListingRead={rememberListingRead}
            onWriteStatusChange={rememberWriteStatus}
            onError={setError}
            onBusyChange={(busy) => {
              setEditLoading(busy);
              onEditorBusyChange?.(busy);
            }}
          />
        </div>
      ) : (
        <>
          <div className="business-pricing-audit-intro">
        <div>
          <span>{marketplaceShort} · FBA ONLY</span>
          <h3>找出未設定或高於一般售價的企業價格</h3>
          <p>同時核對 Business Price 與數量折扣；商品列可直接安全預檢，或前往 Amazon 後台。</p>
        </div>
        <button type="button" className="price-primary-button" onClick={() => void runAudit()} disabled={loading || editLoading || batchBusy}>
          {loading ? "健檢中…" : snapshot ? "重新健檢" : "開始全站 B2B 價格健檢"}
        </button>
      </div>
      <AuditDetailsDisclosure summary="查看詳細規則">
        <div className="business-pricing-recommendation" aria-label="B2B 價格建議規則">
          <strong>Jasper US 建議規則</strong>
          <span>US 一般售價 – USD 1.00</span>
          <span>數量折扣：5 件 5%・10 件 10%・15 件 15%・20 件 20%</span>
        </div>
        <p className="business-pricing-safety-note">編輯前會重新核對指定 SKU、你帳號的 Amazon 可編輯規則，並執行 Amazon Validation Preview（零寫入）；若 Amazon 規則允許安全更新階梯，預設一併帶入 Business Price 與 1–5 階 percent 建議折扣。你仍可明確切換為只改 Business Price，該模式會完整保留現有階梯折扣；正式送出仍需 Touch ID／Windows Hello。</p>
      </AuditDetailsDisclosure>
      {(job && !job.ready ? job.progress.message : progress) && (
        <div className="business-pricing-progress" role="status">
          {job && !job.ready ? job.progress.message : progress}
        </div>
      )}
      {(error || terminalJobError) && (
        <div className="price-error" role="alert">{error ?? terminalJobError}</div>
      )}
      {handoffError && <div className="price-error" role="alert">{handoffError}</div>}
      {!fixedSellerCentralHandoffs && (
        <p className="business-pricing-notice" role="status">
          目前 Notebook Key 需更新後才能安全開啟指定 SKU；為避免開錯商品，舊版不會改開 Seller Central 首頁。
        </p>
      )}

      {visibleSnapshot && (
        <>
          {workflowActivities.length > 0 && (
            <section
              className="business-pricing-activity-summary"
              aria-label="已調整商品進度"
            >
              <div>
                <strong>已調整商品進度</strong>
                <span>
                  本次 App 使用期間 · {workflowActivities.length} 個已調整 SKU 已置頂
                </span>
              </div>
              <dl>
                <div><dt>等待 Amazon</dt><dd>{workflowCounts.waiting_amazon}</dd></div>
                <div><dt>待送 B2B</dt><dd>{workflowCounts.waiting_b2b}</dd></div>
                <div><dt>已完成</dt><dd>{workflowCounts.complete}</dd></div>
              </dl>
            </section>
          )}
          <div className="business-pricing-summary is-interactive" role="group" aria-label="B2B 價格健檢摘要與篩選">
            {FILTERS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`${filter === option.value ? "active" : ""}${
                  option.value === "problem" || option.value === "missing"
                    ? " problem"
                    : ""
                }`}
                aria-pressed={filter === option.value}
                disabled={batchBusy}
                onClick={() => setFilter(option.value)}
              >
                <span>{option.label}</span><strong>{rowCount(visibleSnapshot, option.value)}</strong>
              </button>
            ))}
          </div>
          <div className="content-audit-controls business-pricing-controls">
            <label>
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                value={skuQuery}
                onChange={(event) => setSkuQuery(event.target.value)}
                placeholder="搜尋 Seller SKU"
                aria-label="搜尋 B2B 價格健檢 SKU"
                autoComplete="off"
                spellCheck={false}
                disabled={batchBusy}
              />
            </label>
          </div>
          <div
            className="business-pricing-batch-controls"
            aria-label="B2B 批次選取與操作"
          >
            <label className="business-pricing-select-all">
              <input
                ref={batchSelectAllRef}
                type="checkbox"
                checked={allEligibleVisibleSelected}
                aria-checked={someEligibleVisibleSelected
                  ? "mixed"
                  : allEligibleVisibleSelected}
                aria-label="全選目前可見且可批次處理的 B2B SKU"
                disabled={eligibleVisibleRows.length === 0 || batchBusy}
                onChange={(event) => updateVisibleBatchSelection(
                  event.target.checked,
                )}
              />
              <span>全選目前可處理商品</span>
              <small>{eligibleVisibleRows.length} 個可選</small>
            </label>
            <strong
              className="business-pricing-selected-count"
              role="status"
              aria-live="polite"
              aria-label="B2B 批次已選數量"
            >已選 {batchSelectedRows.length} 個 SKU</strong>
            <button
              type="button"
              className="business-pricing-batch-preview-button"
              aria-label="批次預檢已選 B2B SKU"
              disabled={
                batchSelectedRows.length === 0 ||
                batchBusy ||
                !batchAuditBinding
              }
              onClick={() => void previewBusinessPricingBatch()}
            >{batchPreviewing
                ? "批次預檢中…"
                : `批次預檢 ${batchSelectedRows.length} 個建議（零寫入）`}</button>
          </div>
          {batchError && (
            <div className="price-error business-pricing-batch-error" role="alert">
              {batchError}
            </div>
          )}
          {batchPreview && !batchResult && (
            <section
              className="business-pricing-batch-preview"
              aria-label="B2B 批次預檢結果"
            >
              <div>
                <strong>批次預檢已完成 · {batchPreview.rows.length} 個 SKU</strong>
                <p>目前仍是零寫入；請核對每列階段後，再明確確認送出。</p>
              </div>
              <ul className="business-pricing-batch-preview-list">
                {batchPreview.rows.map((row) => (
                  <li key={row.sellerSku}>
                    <header>
                      <strong>{row.sellerSku}</strong>
                      <span>{batchStageLabel(row.stage)}</span>
                    </header>
                    <BatchValidationDiff validation={row.validation} />
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="price-primary-button"
                aria-label="確認送出勾選 B2B SKU"
                disabled={batchBusy}
                onClick={() => void commitBusinessPricingBatch()}
              >{batchCommitting
                  ? "正在等待 Notebook Key 確認…"
                  : `確認送出勾選的 ${batchPreview.rows.length} 個 SKU`}</button>
            </section>
          )}
          {batchResult && (
            <section
              className={`business-pricing-batch-result is-${
                batchResult.status.toLocaleLowerCase("en-US").replaceAll("_", "-")
              }`}
              aria-label="B2B 批次送出結果"
              role="status"
            >
              <strong>{batchResult.notice}</strong>
              <p className="business-pricing-batch-result-summary">
                Amazon 接受 {batchResult.acceptedCount} 個 · 回查完成 {batchResult.verifiedCount} 個 · 問題 {batchResult.issueCount} 個
              </p>
              {batchObservationMessage && (
                <p className="business-pricing-batch-observation">
                  {batchObservationMessage}
                </p>
              )}
              <ul className="business-pricing-batch-result-list">
                {batchResult.rows.map((row) => (
                  <li key={row.sellerSku}>
                    <header>
                      <strong>{row.sellerSku}</strong>
                      <span>{batchStageLabel(row.stage)}</span>
                      <em>{batchResultStateLabel(row.state)}</em>
                    </header>
                    <BatchResultEvidence row={row} />
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="business-pricing-notice">
            本次已核對 {visibleSnapshot.summary.totalFbaSkuCount} 個 FBA SKU；需要手動處理時可從商品列開啟 Amazon 後台。
          </p>
          <div className="business-pricing-export">
            <button
              type="button"
              className="business-pricing-export-button"
              onClick={() => void exportExcel()}
              disabled={
                exporting ||
                !job?.ready ||
                job.status !== "completed"
              }
            >
              {exporting ? "正在建立 Excel…" : "匯出 B2B 價格 Excel"}
            </button>
            {(!job?.ready || job.status !== "completed") && (
              <small>請先完成本次背景健檢；Excel 只會使用主程序保存的原始快照。</small>
            )}
          </div>
          <div className="business-pricing-list" role="list" aria-label="FBA B2B 價格商品">
            {visibleRows.map((row) => {
              const activity = workflowActivities.find((candidate) =>
                candidate.sellerSku === row.sellerSku
              );
              const rowWorkflow = activity
                ? businessPricingWorkflowProgress(activity)
                : null;
              return (
                <article
                key={row.sellerSku}
                className={`business-pricing-row ${row.status}${
                  row.recommendedPriceMismatch ? " is-price-mismatch" : ""
                }${
                  row.recommendedQuantityDiscountMismatch
                    ? " is-tier-mismatch"
                    : ""
                }${rowWorkflow ? " has-workflow-progress" : ""}${
                  batchSelectedSellerSkus.has(row.sellerSku)
                    ? " is-batch-selected"
                    : ""
                }`}
                role="listitem"
              >
                <div>
                  {eligibleVisibleRows.some((candidate) =>
                    candidate.sellerSku === row.sellerSku
                  ) && (
                    <input
                      type="checkbox"
                      className="business-pricing-row-checkbox"
                      checked={batchSelectedSellerSkus.has(row.sellerSku)}
                      aria-label={`選取 Seller SKU ${row.sellerSku} 進行 B2B 批次預檢`}
                      disabled={batchBusy}
                      onChange={(event) => updateBatchSelection(
                        row.sellerSku,
                        event.target.checked,
                      )}
                    />
                  )}
                  <strong>{row.title || row.sellerSku}</strong>
                  <small>{row.sellerSku} · {row.asin || "無 ASIN"}</small>
                  {businessPricingRowMatchesFilter(row, "problem") &&
                    processingSellerSkus.has(row.sellerSku) && (
                    <small className="business-pricing-row-selection-note">
                      {row.sellerSku} 已有 Amazon 處理中的更新，不能加入本次批次
                    </small>
                  )}
                </div>
                <dl>
                  <div><dt>一般售價</dt><dd>{formatMoney(row.standardPrice)}</dd></div>
                  <div><dt>B2B 價格</dt><dd>{formatMoney(row.businessPrice)}</dd></div>
                  <div><dt>建議 B2B 價格</dt><dd>{formatMoney(recommendedBusinessPrice(row.standardPrice))}</dd></div>
                  <div className="business-pricing-quantity-cell">
                    <dt>目前數量折扣</dt>
                    <dd>
                      <QuantityDiscountPlan
                        plan={row.quantityDiscountPlan}
                        ambiguous={row.quantityDiscountPlanPresence === "ambiguous"}
                      />
                    </dd>
                  </div>
                </dl>
                <div className="business-pricing-row-status">
                  <span>{statusLabel(row)}</span>
                  {recommendationFindings(row).length > 0 && (
                    <div className="business-pricing-findings" aria-label="建議規則問題">
                      {recommendationFindings(row).map((finding) => (
                        <strong key={finding}>{finding}</strong>
                      ))}
                    </div>
                  )}
                  <small>{rowStatusDetail(row)}</small>
                </div>
                <div className="business-pricing-row-actions">
                  <button
                    type="button"
                    onClick={() => void openEditor(row)}
                    disabled={editLoading || loading || batchBusy}
                    aria-busy={openingSellerSku === row.sellerSku}
                  >{openingSellerSku === row.sellerSku
                      ? "正在讀取 Amazon…"
                      : rowWorkflow?.state === "waiting_b2b"
                      ? "繼續預檢 B2B"
                      : rowWorkflow?.state === "waiting_amazon"
                      ? "查看／重新確認"
                      : rowWorkflow?.state === "complete"
                      ? "查看完成結果"
                      : row.status === "missing"
                      ? "設定 B2B 價格"
                      : "調整 B2B 價格"}</button>
                  <button
                    type="button"
                    className="business-pricing-seller-central"
                    onClick={() => void openSellerCentralInventory(row.sellerSku)}
                    disabled={!fixedSellerCentralHandoffs || batchBusy}
                  >前往 Amazon 後台 ↗</button>
                </div>
                {rowWorkflow && <WorkflowProgress progress={rowWorkflow} />}
              </article>
              );
            })}
            {visibleRows.length === 0 && <p className="business-pricing-empty">這個篩選或搜尋沒有商品。</p>}
          </div>
        </>
      )}

        </>
      )}
    </section>
  );
}
