import {
  businessPricingRecommendationFlags,
  recommendedBusinessPricingConfigurationState,
  type RecommendedBusinessPricingConfigurationState,
} from "../../shared/business-pricing-recommendations";

export type BusinessPricingAuditStatus =
  | "configured"
  | "above_standard"
  | "missing"
  | "unsupported"
  | "incomplete";

export type BusinessPricingAuditFilter =
  | "all"
  | "problem"
  | "missing"
  | "configured"
  | "incomplete";

export type BusinessPricingAuditBucket = Exclude<
  BusinessPricingAuditFilter,
  "all"
>;

export type BusinessPricingMoney = Readonly<{
  amount: number;
  currencyCode: string;
}>;

export type BusinessMinimumPricePresence =
  | "absent"
  | "canonical"
  | "ambiguous";

export type BusinessPricingAuditRow = Readonly<{
  sellerSku: string;
  asin: string;
  title: string;
  productType: string;
  standardPrice: BusinessPricingMoney | null;
  businessPrice: BusinessPricingMoney | null;
  businessOfferPresence: "absent" | "present" | "ambiguous";
  quantityDiscountPlan: BusinessQuantityDiscountPlan | null;
  quantityDiscountPlanPresence:
    | "absent"
    | "canonical"
    | "duplicate"
    | "ambiguous";
  recommendedPriceMismatch: boolean;
  recommendedQuantityDiscountMismatch: boolean;
  status: BusinessPricingAuditStatus;
  editable: boolean;
  reason: string;
}>;

export type BusinessPricingAuditSummary = Readonly<{
  totalFbaSkuCount: number;
  configured: number;
  aboveStandard: number;
  missing: number;
  unsupported: number;
  incomplete: number;
  recommendedPriceMismatch: number;
  recommendedQuantityDiscountMismatch: number;
}>;

export type BusinessPricingAuditSnapshot = Readonly<{
  mode: "live" | "demo";
  marketplaceId: string;
  fetchedAt: string;
  rows: readonly BusinessPricingAuditRow[];
  summary: BusinessPricingAuditSummary;
  notice: string;
  workflowActivities?: readonly BusinessPricingWorkflowActivity[];
}>;

export type BusinessPricingCapability = Readonly<{
  supported: boolean;
  editable: boolean;
  reason: string | null;
  schemaChecksum: string | null;
  quantityDiscountsSupported: boolean;
  quantityDiscountsEditable: boolean;
  quantityDiscountsReason: string | null;
}>;

export type BusinessQuantityDiscountTier = Readonly<{
  lowerBound: number;
  percent: number;
}>;

export type BusinessQuantityDiscountPlan = Readonly<{
  discountType: "percent" | "fixed";
  levels: readonly Readonly<{
    lowerBound: number;
    value: number;
  }>[];
}>;

export type BusinessPricingListingSnapshot = Readonly<{
  mode: "live" | "demo";
  marketplaceId: string;
  sellerSku: string;
  asin: string | null;
  title: string;
  productType: string;
  standardPrice: BusinessPricingMoney | null;
  minimumPrice: BusinessPricingMoney | null;
  minimumPricePresence: BusinessMinimumPricePresence;
  businessPrice: BusinessPricingMoney | null;
  businessOfferPresence: "absent" | "present" | "ambiguous";
  businessPricingManagedByAutomation: boolean;
  quantityDiscountPlan: BusinessQuantityDiscountPlan | null;
  quantityDiscountPlanPresence:
    | "absent"
    | "canonical"
    | "duplicate"
    | "ambiguous";
  quantityDiscountPlanHash: string | null;
  businessOfferGuardHash: string;
  businessOfferProtectedHash: string;
  businessPricingCapability: BusinessPricingCapability;
  fetchedAt: string;
  notice: string | null;
  writeStatus: BusinessPriceWriteStatus | null;
}>;

export type BusinessPriceWriteBody = Readonly<{
  marketplaceId: string;
  sellerSku: string;
  expectedStandardPrice: number;
  expectedBusinessPrice: number | null;
  newBusinessPrice: number;
  expectedMinimumPrice?: number | null;
  expectedQuantityDiscountPlanHash?: string | null;
  quantityDiscountTiers?: readonly BusinessQuantityDiscountTier[];
  idempotencyKey: string;
}>;

export type BusinessPriceIssue = Readonly<{
  severity: string;
  message: string;
}>;

export type BusinessPriceValidation = Readonly<{
  mode: "live" | "demo";
  status: "VALID" | "SIMULATED";
  marketplaceId: string;
  sellerSku: string;
  asin: string;
  productType: string;
  standardPrice: BusinessPricingMoney;
  previousBusinessPrice: BusinessPricingMoney | null;
  requestedBusinessPrice: BusinessPricingMoney;
  previousMinimumPrice: BusinessPricingMoney | null;
  requestedMinimumPrice: BusinessPricingMoney | null;
  lowestTierUnitPrice: BusinessPricingMoney | null;
  minimumPriceChange: "preserve" | "lower";
  minimumPriceProtectedHash: string | null;
  minimumPriceCanonicalPatchHash: string | null;
  businessPriceValidation:
    | "validated"
    | "final-state-validated"
    | "deferred-until-minimum-price";
  previousQuantityDiscountPlan: BusinessQuantityDiscountPlan | null;
  previousQuantityDiscountPlanHash: string | null;
  requestedQuantityDiscountPlan: BusinessQuantityDiscountPlan | null;
  quantityDiscountPlanPresence:
    | "absent"
    | "canonical"
    | "duplicate"
    | "ambiguous";
  quantityDiscountPlanChange: "preserve" | "replace";
  businessOfferGuardHash: string;
  businessOfferProtectedHash: string;
  schemaChecksum: string;
  fbaEvidenceHash: string;
  canonicalPatchHash: string;
  validationIssuesHash: string;
  validatedAt: string;
  issues: readonly BusinessPriceIssue[];
  notice: string;
}>;

export type SubmittedBusinessPricePreview = Readonly<{
  body: BusinessPriceWriteBody;
  validation: BusinessPriceValidation;
}>;

export type BusinessPriceUpdate = Readonly<{
  mode: "live" | "demo";
  status: "ACCEPTED" | "SIMULATED";
  marketplaceId: string;
  sellerSku: string;
  asin: string;
  productType: string;
  standardPrice: BusinessPricingMoney;
  previousBusinessPrice: BusinessPricingMoney | null;
  requestedBusinessPrice: BusinessPricingMoney;
  previousMinimumPrice: BusinessPricingMoney | null;
  requestedMinimumPrice: BusinessPricingMoney | null;
  lowestTierUnitPrice: BusinessPricingMoney | null;
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
  acceptedAt: string;
  issues: readonly BusinessPriceIssue[];
  notice: string;
}>;

export type BusinessPriceWriteStatus = Readonly<{
  mode: "live";
  status: "PROCESSING" | "VERIFIED";
  stage: "minimum_price" | "business_price";
  marketplaceId: string;
  sellerSku: string;
  asin: string;
  productType: string;
  acceptedAt: string;
  verifiedAt: string | null;
  requestId: string | null;
  submissionId: string | null;
  verified: boolean;
  authoritative: boolean;
  canResend: false;
  businessPriceSubmitted: boolean;
  previousBusinessPrice: BusinessPricingMoney | null;
  requestedBusinessPrice: BusinessPricingMoney | null;
  previousMinimumPrice: BusinessPricingMoney | null;
  requestedMinimumPrice: BusinessPricingMoney | null;
  lowestTierUnitPrice: BusinessPricingMoney | null;
  previousQuantityDiscountPlan: BusinessQuantityDiscountPlan | null;
  requestedQuantityDiscountPlan: BusinessQuantityDiscountPlan | null;
  quantityDiscountPlanChange: "preserve" | "replace" | null;
  notice: string;
}>;

export type BusinessPricingWorkflowActivity = Readonly<{
  sellerSku: string;
  writeStatus: BusinessPriceWriteStatus;
  minimumPriceProgress: "not_required" | "submitted" | "verified";
  observedMinimumPrice: BusinessPricingMoney | null;
  observedBusinessPrice: BusinessPricingMoney | null;
}>;

export type BusinessPricingWorkflowStepState =
  | "complete"
  | "current"
  | "pending"
  | "skipped";

export type BusinessPricingWorkflowProgress = Readonly<{
  state: "waiting_amazon" | "waiting_b2b" | "complete";
  headline: string;
  steps: readonly Readonly<{
    label: string;
    state: BusinessPricingWorkflowStepState;
    statusLabel?: string;
    target: BusinessPricingMoney | null;
    observed: BusinessPricingMoney | null;
  }>[];
}>;

function minimumPriceWasChanged(status: BusinessPriceWriteStatus): boolean {
  return Boolean(
    status.previousMinimumPrice &&
    status.requestedMinimumPrice &&
    (status.previousMinimumPrice.currencyCode !==
        status.requestedMinimumPrice.currencyCode ||
      status.previousMinimumPrice.amount !== status.requestedMinimumPrice.amount),
  );
}

function sameWriteObservationBinding(
  current: BusinessPriceWriteStatus,
  previous: BusinessPriceWriteStatus,
): boolean {
  return current.stage === previous.stage &&
    current.acceptedAt === previous.acceptedAt &&
    current.requestId === previous.requestId &&
    current.submissionId === previous.submissionId;
}

function continuesVerifiedMinimumIntoBusiness(
  current: BusinessPriceWriteStatus,
  previous: BusinessPricingWorkflowActivity | undefined,
): boolean {
  return Boolean(
    previous?.writeStatus.stage === "minimum_price" &&
    previous.minimumPriceProgress === "verified" &&
    current.stage === "business_price" &&
    sameMoney(
      previous.writeStatus.requestedMinimumPrice,
      current.previousMinimumPrice,
    ) &&
    sameMoney(
      current.previousMinimumPrice,
      current.requestedMinimumPrice,
    ),
  );
}

function nextMinimumPriceProgress(
  status: BusinessPriceWriteStatus,
  previous: BusinessPricingWorkflowActivity | undefined,
): BusinessPricingWorkflowActivity["minimumPriceProgress"] {
  if (status.stage === "minimum_price") {
    return status.status === "VERIFIED" ? "verified" : "submitted";
  }
  if (
    previous &&
    sameWriteObservationBinding(status, previous.writeStatus)
  ) {
    return previous.minimumPriceProgress;
  }
  if (
    continuesVerifiedMinimumIntoBusiness(status, previous) ||
    minimumPriceWasChanged(status)
  ) {
    return "verified";
  }
  return "not_required";
}

export function businessPricingWorkflowProgress(
  activity: BusinessPricingWorkflowActivity,
): BusinessPricingWorkflowProgress {
  const status = activity.writeStatus;
  if (status.stage === "minimum_price") {
    const minimumVerified = status.status === "VERIFIED";
    const minimumReadbackLabel = minimumVerified
      ? "回查成功"
      : activity.observedMinimumPrice
      ? sameMoney(
          activity.observedMinimumPrice,
          status.requestedMinimumPrice,
        )
        ? "已回查，等待 Amazon 確認"
        : "已回查，尚未相符"
      : "等待 Amazon 回查";
    return {
      state: minimumVerified ? "waiting_b2b" : "waiting_amazon",
      headline: minimumVerified
        ? "最低價已確認，待預檢 B2B"
        : "Amazon 正在同步最低價",
      steps: [
        {
          label: "送出最低價格",
          state: "complete",
          target: null,
          observed: null,
        },
        {
          label: "已回查最低價格",
          state: minimumVerified ? "complete" : "current",
          statusLabel: minimumReadbackLabel,
          target: status.requestedMinimumPrice,
          observed: activity.observedMinimumPrice,
        },
        {
          label: "送出 B2B 價格",
          state: minimumVerified ? "current" : "pending",
          target: null,
          observed: null,
        },
        {
          label: "已回查 B2B 價格",
          state: "pending",
          target: null,
          observed: null,
        },
      ],
    };
  }

  const businessVerified = status.status === "VERIFIED";
  const minimumSubmitted = activity.minimumPriceProgress !== "not_required";
  const minimumVerified = activity.minimumPriceProgress === "verified";
  return {
    state: businessVerified ? "complete" : "waiting_amazon",
    headline: businessVerified
      ? "B2B 價格已回查確認"
      : "Amazon 正在同步 B2B 價格",
    steps: [
      {
        label: "送出最低價格",
        state: minimumSubmitted ? "complete" : "skipped",
        target: null,
        observed: null,
      },
      {
        label: "已回查最低價格",
        state: minimumVerified
          ? "complete"
          : minimumSubmitted
          ? "current"
          : "skipped",
        ...(minimumVerified
          ? { statusLabel: "回查成功" }
          : minimumSubmitted && activity.observedMinimumPrice
          ? { statusLabel: "已回查，尚未確認" }
          : {}),
        target: minimumSubmitted ? status.requestedMinimumPrice : null,
        observed: minimumSubmitted ? activity.observedMinimumPrice : null,
      },
      {
        label: "送出 B2B 價格",
        state: "complete",
        target: null,
        observed: null,
      },
      {
        label: "已回查 B2B 價格",
        state: businessVerified ? "complete" : "current",
        statusLabel: businessVerified
          ? "回查成功"
          : activity.observedBusinessPrice
          ? sameMoney(
              activity.observedBusinessPrice,
              status.requestedBusinessPrice,
            )
            ? "已回查，等待 Amazon 確認"
            : "已回查，尚未相符"
          : "等待 Amazon 回查",
        target: status.requestedBusinessPrice,
        observed: activity.observedBusinessPrice,
      },
    ],
  };
}

export function applyBusinessPriceWriteStatusToAuditSnapshot(
  snapshot: BusinessPricingAuditSnapshot,
  writeStatus: BusinessPriceWriteStatus,
): BusinessPricingAuditSnapshot {
  const matchingRows = snapshot.rows.filter((row) =>
    row.sellerSku === writeStatus.sellerSku &&
    row.asin === writeStatus.asin &&
    row.productType === writeStatus.productType
  );
  if (
    snapshot.mode !== writeStatus.mode ||
    snapshot.marketplaceId !== writeStatus.marketplaceId ||
    matchingRows.length !== 1
  ) {
    throw new Error("B2B 價格處理進度與目前健檢快照不一致。");
  }
  const previousActivity = (snapshot.workflowActivities ?? []).find(
    (activity) => activity.sellerSku === writeStatus.sellerSku &&
      activity.writeStatus.asin === writeStatus.asin &&
      activity.writeStatus.productType === writeStatus.productType &&
      activity.writeStatus.marketplaceId === writeStatus.marketplaceId,
  );
  const minimumPriceProgress = nextMinimumPriceProgress(
    writeStatus,
    previousActivity,
  );
  const sameObservationBinding = previousActivity
    ? sameWriteObservationBinding(
        writeStatus,
        previousActivity.writeStatus,
      )
    : false;
  const continuesMinimumLifecycle = continuesVerifiedMinimumIntoBusiness(
    writeStatus,
    previousActivity,
  );
  const canCarryMinimumObservation = continuesMinimumLifecycle && sameMoney(
    previousActivity?.observedMinimumPrice ?? null,
    writeStatus.previousMinimumPrice,
  );
  const workflowActivities = [
    {
      sellerSku: writeStatus.sellerSku,
      writeStatus,
      minimumPriceProgress,
      observedMinimumPrice:
        sameObservationBinding || canCarryMinimumObservation
          ? previousActivity?.observedMinimumPrice ?? null
          : null,
      observedBusinessPrice:
        sameObservationBinding && writeStatus.stage === "business_price"
          ? previousActivity?.observedBusinessPrice ?? null
          : null,
    },
    ...(snapshot.workflowActivities ?? []).filter((activity) =>
      activity.sellerSku !== writeStatus.sellerSku
    ),
  ].sort((left, right) =>
    Date.parse(right.writeStatus.acceptedAt) -
      Date.parse(left.writeStatus.acceptedAt)
  );
  return { ...snapshot, workflowActivities };
}

export function applyBusinessPricingListingReadToAuditSnapshot(
  snapshot: BusinessPricingAuditSnapshot,
  listing: BusinessPricingListingSnapshot,
): BusinessPricingAuditSnapshot {
  if (!listing.writeStatus) {
    throw new Error("B2B 價格回查沒有可顯示的處理進度。");
  }
  const withStatus = applyBusinessPriceWriteStatusToAuditSnapshot(
    snapshot,
    listing.writeStatus,
  );
  return {
    ...withStatus,
    workflowActivities: withStatus.workflowActivities?.map((activity) =>
      activity.sellerSku === listing.sellerSku
        ? {
            ...activity,
            observedMinimumPrice: listing.minimumPricePresence === "canonical"
              ? listing.minimumPrice
              : null,
            observedBusinessPrice: listing.businessOfferPresence === "present"
              ? listing.businessPrice
              : null,
          }
        : activity
    ),
  };
}

export function retainBusinessPricingWorkflowActivities(
  snapshot: BusinessPricingAuditSnapshot,
  activities: readonly BusinessPricingWorkflowActivity[],
): readonly BusinessPricingWorkflowActivity[] {
  return activities.filter((activity) => {
    const status = activity.writeStatus;
    return activity.sellerSku === status.sellerSku &&
      status.mode === snapshot.mode &&
      status.marketplaceId === snapshot.marketplaceId &&
      snapshot.rows.filter((row) =>
        row.sellerSku === status.sellerSku &&
        row.asin === status.asin &&
        row.productType === status.productType
      ).length === 1;
  });
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("B2B 價格健檢資料格式無效。");
  }
  return value as Record<string, unknown>;
}

function exactText(
  value: unknown,
  label: string,
  maximum: number,
  allowEmpty = false,
): string {
  if (
    typeof value !== "string" ||
    value.length > maximum ||
    value !== value.trim() ||
    (!allowEmpty && !value) ||
    /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/u.test(value)
  ) {
    throw new Error(`B2B 價格健檢的${label}無法安全辨識。`);
  }
  return value;
}

function displayText(
  value: unknown,
  label: string,
  maximum: number,
  allowEmpty = false,
): string {
  if (
    typeof value !== "string" ||
    value.length > maximum ||
    value.includes("\u0000") ||
    (!allowEmpty && !value.trim())
  ) {
    throw new Error(`B2B 價格健檢的${label}無法安全顯示。`);
  }
  return value;
}

function count(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 25_000) {
    throw new Error(`B2B 價格健檢的${label}摘要無效。`);
  }
  return Number(value);
}

function money(value: unknown, label: string): BusinessPricingMoney | null {
  if (value === null) return null;
  const source = record(value);
  if (
    typeof source.amount !== "number" ||
    !Number.isFinite(source.amount) ||
    source.amount <= 0 ||
    source.amount > 1_000_000_000 ||
    typeof source.currencyCode !== "string" ||
    !/^[A-Z]{3}$/u.test(source.currencyCode)
  ) {
    throw new Error(`B2B 價格健檢的${label}無效。`);
  }
  return { amount: source.amount, currencyCode: source.currencyCode };
}

function parseRow(value: unknown): BusinessPricingAuditRow {
  const source = record(value);
  const status = source.status;
  const presence = source.businessOfferPresence;
  if (
    status !== "configured" &&
    status !== "above_standard" &&
    status !== "missing" &&
    status !== "unsupported" &&
    status !== "incomplete"
  ) {
    throw new Error("B2B 價格健檢的列狀態無效。");
  }
  if (presence !== "absent" && presence !== "present" && presence !== "ambiguous") {
    throw new Error("B2B 價格健檢的 offer 證據無效。");
  }
  if (typeof source.editable !== "boolean") {
    throw new Error("B2B 價格健檢的編輯能力無效。");
  }
  const standardPrice = money(source.standardPrice, "標準售價");
  const businessPrice = money(source.businessPrice, "B2B 價格");
  const legacyQuantityDiscountShape =
    source.quantityDiscountPlan === undefined &&
    source.quantityDiscountPlanPresence === undefined;
  const quantityDiscount = legacyQuantityDiscountShape
    ? { plan: null, presence: "ambiguous" as const }
    : parseAuditQuantityDiscountPlan(
        source.quantityDiscountPlan,
        source.quantityDiscountPlanPresence,
      );
  const recommendationFlags = businessPricingRecommendationFlags({
    standardPrice,
    businessPrice,
    quantityDiscountPlan: quantityDiscount.plan,
    quantityDiscountPlanPresence: quantityDiscount.presence,
  });
  for (const [key, expected] of [
    ["recommendedPriceMismatch", recommendationFlags.recommendedPriceMismatch],
    [
      "recommendedQuantityDiscountMismatch",
      recommendationFlags.recommendedQuantityDiscountMismatch,
    ],
  ] as const) {
    const supplied = source[key];
    if (supplied !== undefined && (typeof supplied !== "boolean" || supplied !== expected)) {
      throw new Error("B2B 價格健檢的建議分類與價格證據不一致。");
    }
  }
  if (
    ((status === "configured" || status === "above_standard") &&
      (presence !== "present" || !businessPrice)) ||
    (status === "missing" && (presence !== "absent" || businessPrice !== null)) ||
    (status === "configured" &&
      (!businessPrice ||
        (standardPrice && businessPrice.amount > standardPrice.amount))) ||
    (status === "above_standard" &&
      (!standardPrice || !businessPrice ||
        businessPrice.amount <= standardPrice.amount))
  ) {
    throw new Error("B2B 價格健檢的價格、狀態與能力不一致。");
  }
  if (
    standardPrice &&
    businessPrice &&
    standardPrice.currencyCode !== businessPrice.currencyCode
  ) {
    throw new Error("B2B 價格健檢的幣別不一致。");
  }
  return {
    sellerSku: exactText(source.sellerSku, "Seller SKU", 40),
    asin: exactText(source.asin, "ASIN", 10, true),
    title: displayText(source.title, "商品名稱", 2_000, true),
    productType: exactText(source.productType, "商品類型", 120, true),
    standardPrice,
    businessPrice,
    businessOfferPresence: presence,
    quantityDiscountPlan: quantityDiscount.plan,
    quantityDiscountPlanPresence: quantityDiscount.presence,
    ...recommendationFlags,
    status,
    // Audit output is always rendered read-only. Keep accepting the legacy
    // boolean so older cache/demo/API payloads remain parseable, but never let
    // that historical capability bit reopen mutation UI.
    editable: false,
    reason: exactText(source.reason, "原因", 2_000),
  };
}

export function parseBusinessPricingAuditSnapshot(
  value: unknown,
): BusinessPricingAuditSnapshot {
  const source = record(value);
  if (source.mode !== "live" && source.mode !== "demo") {
    throw new Error("B2B 價格健檢模式無效。");
  }
  const marketplaceId = exactText(source.marketplaceId, "站點", 32);
  const fetchedAt = exactText(source.fetchedAt, "快照時間", 40);
  if (!Number.isFinite(Date.parse(fetchedAt))) {
    throw new Error("B2B 價格健檢快照時間無效。");
  }
  if (!Array.isArray(source.rows) || source.rows.length > 25_000) {
    throw new Error("B2B 價格健檢商品列無效。");
  }
  const rows = source.rows.map(parseRow);
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.sellerSku)) {
      throw new Error("B2B 價格健檢含有重複 Seller SKU。");
    }
    seen.add(row.sellerSku);
  }
  const rawSummary = record(source.summary);
  const summary: BusinessPricingAuditSummary = {
    totalFbaSkuCount: count(rawSummary.totalFbaSkuCount, "FBA SKU"),
    configured: count(rawSummary.configured, "已設定"),
    aboveStandard: count(rawSummary.aboveStandard, "高於一般售價"),
    missing: count(rawSummary.missing, "未設定"),
    unsupported: count(rawSummary.unsupported, "不支援"),
    incomplete: count(rawSummary.incomplete, "資料未完成"),
    recommendedPriceMismatch: rawSummary.recommendedPriceMismatch === undefined
      ? rows.filter((row) => row.recommendedPriceMismatch).length
      : count(rawSummary.recommendedPriceMismatch, "不符建議 B2B 價格"),
    recommendedQuantityDiscountMismatch:
      rawSummary.recommendedQuantityDiscountMismatch === undefined
        ? rows.filter((row) => row.recommendedQuantityDiscountMismatch).length
        : count(
            rawSummary.recommendedQuantityDiscountMismatch,
            "未正確設定階梯折扣",
          ),
  };
  const actual = {
    configured: rows.filter((row) => row.status === "configured").length,
    aboveStandard: rows.filter((row) => row.status === "above_standard").length,
    missing: rows.filter((row) => row.status === "missing").length,
    unsupported: rows.filter((row) => row.status === "unsupported").length,
    incomplete: rows.filter((row) => row.status === "incomplete").length,
    recommendedPriceMismatch: rows.filter((row) =>
      row.recommendedPriceMismatch
    ).length,
    recommendedQuantityDiscountMismatch: rows.filter((row) =>
      row.recommendedQuantityDiscountMismatch
    ).length,
  };
  if (
    summary.totalFbaSkuCount !== rows.length ||
    summary.configured !== actual.configured ||
    summary.aboveStandard !== actual.aboveStandard ||
    summary.missing !== actual.missing ||
    summary.unsupported !== actual.unsupported ||
    summary.incomplete !== actual.incomplete ||
    summary.recommendedPriceMismatch !== actual.recommendedPriceMismatch ||
    summary.recommendedQuantityDiscountMismatch !==
      actual.recommendedQuantityDiscountMismatch
  ) {
    throw new Error("B2B 價格健檢摘要與商品列不一致。");
  }
  return {
    mode: source.mode,
    marketplaceId,
    fetchedAt,
    rows,
    summary,
    notice: exactText(source.notice, "說明", 4_000),
  };
}

export function businessPricingRowMatchesFilter(
  row: BusinessPricingAuditRow,
  filter: BusinessPricingAuditFilter,
): boolean {
  if (filter === "all") return true;
  return businessPricingRowBucket(row) === filter;
}

export function businessPricingRowBucket(
  row: BusinessPricingAuditRow,
): BusinessPricingAuditBucket {
  if (
    row.standardPrice === null ||
    row.status === "incomplete" ||
    row.status === "unsupported"
  ) return "incomplete";
  if (row.status === "missing") return "missing";
  const configurationState = businessPricingRowConfigurationState(row);
  if (configurationState === "needs_confirmation") return "incomplete";
  if (configurationState === "correct") return "configured";
  return "problem";
}

export function isBusinessPricingRowCorrectlyConfigured(
  row: BusinessPricingAuditRow,
): boolean {
  return businessPricingRowConfigurationState(row) === "correct";
}

export function businessPricingRowConfigurationState(
  row: BusinessPricingAuditRow,
): RecommendedBusinessPricingConfigurationState {
  return recommendedBusinessPricingConfigurationState(row);
}

export function applyVerifiedBusinessPriceToAuditSnapshot(
  snapshot: BusinessPricingAuditSnapshot,
  update: BusinessPriceUpdate,
): BusinessPricingAuditSnapshot {
  if (
    snapshot.mode !== update.mode ||
    snapshot.marketplaceId !== update.marketplaceId ||
    snapshot.rows.filter((row) => row.sellerSku === update.sellerSku).length !== 1
  ) {
    throw new Error("B2B 價格回查結果與目前健檢快照不一致。");
  }
  const aboveStandard =
    update.requestedBusinessPrice.currencyCode ===
      update.standardPrice.currencyCode &&
    update.requestedBusinessPrice.amount > update.standardPrice.amount;
  const rows = snapshot.rows.map((row) => {
    if (row.sellerSku !== update.sellerSku) return row;
    const updatedQuantityDiscountPlan = update.quantityDiscountPlanChange === "replace"
      ? update.requestedQuantityDiscountPlan
      : row.quantityDiscountPlan;
    const updatedQuantityDiscountPlanPresence =
      update.quantityDiscountPlanChange === "replace"
        ? "canonical" as const
        : row.quantityDiscountPlanPresence;
    const recommendationFlags = businessPricingRecommendationFlags({
      standardPrice: update.standardPrice,
      businessPrice: update.requestedBusinessPrice,
      quantityDiscountPlan: updatedQuantityDiscountPlan,
      quantityDiscountPlanPresence: updatedQuantityDiscountPlanPresence,
    });
    return {
          ...row,
          asin: update.asin,
          productType: update.productType,
          standardPrice: update.standardPrice,
          businessPrice: update.requestedBusinessPrice,
          businessOfferPresence: "present" as const,
          editable: false,
          quantityDiscountPlan: updatedQuantityDiscountPlan,
          quantityDiscountPlanPresence: updatedQuantityDiscountPlanPresence,
          ...recommendationFlags,
          status: aboveStandard ? "above_standard" as const : "configured" as const,
          reason: aboveStandard
            ? "Amazon Business 價格仍高於一般售價；主程序已唯讀回查確認。"
            : "已設定 Amazon Business 價格，且主程序唯讀回查確認。",
        };
  });
  return {
    ...snapshot,
    rows,
    summary: {
      totalFbaSkuCount: rows.length,
      configured: rows.filter((row) => row.status === "configured").length,
      aboveStandard: rows.filter((row) => row.status === "above_standard").length,
      missing: rows.filter((row) => row.status === "missing").length,
      unsupported: rows.filter((row) => row.status === "unsupported").length,
      incomplete: rows.filter((row) => row.status === "incomplete").length,
      recommendedPriceMismatch: rows.filter((row) =>
        row.recommendedPriceMismatch
      ).length,
      recommendedQuantityDiscountMismatch: rows.filter((row) =>
        row.recommendedQuantityDiscountMismatch
      ).length,
    },
  };
}

export function applyVerifiedBusinessPricingListingToAuditSnapshot(
  snapshot: BusinessPricingAuditSnapshot,
  listing: BusinessPricingListingSnapshot,
): BusinessPricingAuditSnapshot {
  if (
    listing.mode !== "live" ||
    snapshot.mode !== listing.mode ||
    snapshot.marketplaceId !== listing.marketplaceId ||
    !listing.asin ||
    !listing.standardPrice ||
    !listing.businessPrice ||
    listing.businessOfferPresence !== "present" ||
    listing.writeStatus?.status !== "VERIFIED" ||
    listing.writeStatus.stage !== "business_price" ||
    snapshot.rows.filter((row) => row.sellerSku === listing.sellerSku).length !== 1
  ) {
    throw new Error("B2B 價格 canonical 回查與目前健檢快照不一致。");
  }
  const aboveStandard =
    listing.businessPrice.currencyCode === listing.standardPrice.currencyCode &&
    listing.businessPrice.amount > listing.standardPrice.amount;
  const rows = snapshot.rows.map((row) => {
    if (row.sellerSku !== listing.sellerSku) return row;
    const recommendationFlags = businessPricingRecommendationFlags({
      standardPrice: listing.standardPrice,
      businessPrice: listing.businessPrice,
      quantityDiscountPlan: listing.quantityDiscountPlan,
      quantityDiscountPlanPresence: listing.quantityDiscountPlanPresence,
    });
    return {
      ...row,
      asin: listing.asin!,
      title: listing.title,
      productType: listing.productType,
      standardPrice: listing.standardPrice,
      businessPrice: listing.businessPrice,
      businessOfferPresence: "present" as const,
      quantityDiscountPlan: listing.quantityDiscountPlan,
      quantityDiscountPlanPresence: listing.quantityDiscountPlanPresence,
      editable: listing.businessPricingCapability.editable,
      ...recommendationFlags,
      status: aboveStandard ? "above_standard" as const : "configured" as const,
      reason: aboveStandard
        ? "Amazon Business 價格仍高於一般售價；主程序已唯讀回查確認。"
        : "已設定 Amazon Business 價格，且主程序唯讀回查確認。",
    };
  });
  return {
    ...snapshot,
    rows,
    summary: {
      totalFbaSkuCount: rows.length,
      configured: rows.filter((row) => row.status === "configured").length,
      aboveStandard: rows.filter((row) => row.status === "above_standard").length,
      missing: rows.filter((row) => row.status === "missing").length,
      unsupported: rows.filter((row) => row.status === "unsupported").length,
      incomplete: rows.filter((row) => row.status === "incomplete").length,
      recommendedPriceMismatch: rows.filter((row) =>
        row.recommendedPriceMismatch
      ).length,
      recommendedQuantityDiscountMismatch: rows.filter((row) =>
        row.recommendedQuantityDiscountMismatch
      ).length,
    },
  };
}

function optionalExactText(
  value: unknown,
  label: string,
  maximum: number,
): string | null {
  return value === null ? null : exactText(value, label, maximum);
}

function exactHash(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`B2B 價格的${label}無法安全辨識。`);
  }
  return value;
}

function optionalExactHash(value: unknown, label: string): string | null {
  return value === null ? null : exactHash(value, label);
}

function parseCanonicalQuantityDiscountPlan(
  value: unknown,
): BusinessQuantityDiscountPlan {
  const source = record(value);
  if (source.discountType !== "percent" && source.discountType !== "fixed") {
    throw new Error("B2B 數量折扣類型無效。");
  }
  if (!Array.isArray(source.levels) || source.levels.length < 1 ||
      source.levels.length > 5) {
    throw new Error("B2B 數量折扣階數無效。");
  }
  const sourceLevels = source.levels;
  const levels = sourceLevels.map((entry, index) => {
    const level = record(entry);
    if (
      !Number.isSafeInteger(level.lowerBound) ||
      Number(level.lowerBound) <= 0 ||
      typeof level.value !== "number" ||
      !Number.isFinite(level.value) ||
      level.value <= 0 ||
      (source.discountType === "percent" && level.value >= 100)
    ) {
      throw new Error("B2B 數量折扣內容無效。");
    }
    const previous = index > 0
      ? sourceLevels[index - 1] as Record<string, unknown>
      : null;
    if (previous && (
      Number(level.lowerBound) <= Number(previous.lowerBound) ||
      (source.discountType === "percent"
        ? level.value <= Number(previous.value)
        : level.value >= Number(previous.value))
    )) {
      throw new Error("B2B 數量折扣必須依件數遞增並提供更優惠的階段。");
    }
    return Object.freeze({
      lowerBound: Number(level.lowerBound),
      value: level.value,
    });
  });
  return Object.freeze({ discountType: source.discountType, levels });
}

function parseAuditQuantityDiscountPlan(
  value: unknown,
  presence: unknown,
): {
  plan: BusinessQuantityDiscountPlan | null;
  presence: "absent" | "canonical" | "duplicate" | "ambiguous";
} {
  if (presence !== "absent" && presence !== "canonical" &&
      presence !== "duplicate" && presence !== "ambiguous") {
    throw new Error("B2B 數量折扣證據無效。");
  }
  if (presence === "absent" || presence === "ambiguous") {
    if (value !== null) {
      throw new Error("B2B 數量折扣空值證據不一致。");
    }
    return { plan: null, presence };
  }
  return { plan: parseCanonicalQuantityDiscountPlan(value), presence };
}

function parseQuantityDiscountPlan(
  value: unknown,
  presence: unknown,
  hash: unknown,
): {
  plan: BusinessQuantityDiscountPlan | null;
  presence: "absent" | "canonical" | "duplicate" | "ambiguous";
  hash: string | null;
} {
  const parsed = parseAuditQuantityDiscountPlan(value, presence);
  if (parsed.presence === "absent" || parsed.presence === "ambiguous") {
    if (hash !== null) {
      throw new Error("B2B 數量折扣空值證據不一致。");
    }
    return { ...parsed, hash: null };
  }
  return {
    ...parsed,
    hash: exactHash(hash, "數量折扣 hash"),
  };
}

function parseMinimumPriceEvidence(
  value: unknown,
  presence: unknown,
): Readonly<{
  minimumPrice: BusinessPricingMoney | null;
  minimumPricePresence: BusinessMinimumPricePresence;
}> {
  const minimumPrice = value === undefined
    ? null
    : money(value, "最低允許售價");
  const minimumPricePresence = presence === undefined
    ? minimumPrice === null ? "ambiguous" : "canonical"
    : presence;
  if (
    minimumPricePresence !== "absent" &&
    minimumPricePresence !== "canonical" &&
    minimumPricePresence !== "ambiguous"
  ) {
    throw new Error("B2B 價格的最低允許售價證據無效。");
  }
  if (
    (minimumPricePresence === "canonical" && minimumPrice === null) ||
    (minimumPricePresence !== "canonical" && minimumPrice !== null)
  ) {
    throw new Error("B2B 價格的最低允許售價與證據不一致。");
  }
  return Object.freeze({ minimumPrice, minimumPricePresence });
}

export function parseBusinessPricingListingSnapshot(
  value: unknown,
): BusinessPricingListingSnapshot {
  const source = record(value);
  if (source.mode !== "live" && source.mode !== "demo") {
    throw new Error("B2B 價格資料模式無效。");
  }
  const marketplaceId = exactText(source.marketplaceId, "站點", 32);
  const sellerSku = exactText(source.sellerSku, "Seller SKU", 40);
  const presence = source.businessOfferPresence;
  if (presence !== "absent" && presence !== "present" && presence !== "ambiguous") {
    throw new Error("B2B 價格 offer 證據無效。");
  }
  const standardPrice = money(source.standardPrice, "標準售價");
  const businessPrice = money(source.businessPrice, "B2B 價格");
  const minimumPriceEvidence = parseMinimumPriceEvidence(
    source.minimumPrice,
    source.minimumPricePresence,
  );
  const quantityDiscount = parseQuantityDiscountPlan(
    source.quantityDiscountPlan,
    source.quantityDiscountPlanPresence,
    source.quantityDiscountPlanHash,
  );
  if (
    (presence === "present" && !businessPrice) ||
    (presence === "absent" && businessPrice !== null) ||
    (standardPrice && businessPrice &&
      standardPrice.currencyCode !== businessPrice.currencyCode) ||
    (standardPrice && minimumPriceEvidence.minimumPrice &&
      standardPrice.currencyCode !==
        minimumPriceEvidence.minimumPrice.currencyCode) ||
    (businessPrice && minimumPriceEvidence.minimumPrice &&
      businessPrice.currencyCode !==
        minimumPriceEvidence.minimumPrice.currencyCode)
  ) {
    throw new Error("B2B 價格與 offer 證據不一致。");
  }
  if (typeof source.businessPricingManagedByAutomation !== "boolean" ||
      (source.businessPricingManagedByAutomation && presence !== "present")) {
    throw new Error("B2B 自動定價管理證據無效。");
  }
  const rawCapability = record(source.businessPricingCapability);
  if (
    typeof rawCapability.supported !== "boolean" ||
    typeof rawCapability.editable !== "boolean" ||
    (rawCapability.reason !== null && typeof rawCapability.reason !== "string") ||
    (rawCapability.schemaChecksum !== null &&
      typeof rawCapability.schemaChecksum !== "string") ||
    typeof rawCapability.quantityDiscountsSupported !== "boolean" ||
    typeof rawCapability.quantityDiscountsEditable !== "boolean" ||
    (rawCapability.quantityDiscountsReason !== null &&
      typeof rawCapability.quantityDiscountsReason !== "string") ||
    (rawCapability.editable && !rawCapability.supported) ||
    (rawCapability.quantityDiscountsEditable &&
      (!rawCapability.quantityDiscountsSupported || !rawCapability.editable))
  ) {
    throw new Error("B2B 價格 PTD 能力資料無效。");
  }
  const capabilityReason = rawCapability.reason === null
    ? null
    : displayText(rawCapability.reason, "PTD 說明", 4_000);
  const schemaChecksum = rawCapability.schemaChecksum === null
    ? null
    : exactText(rawCapability.schemaChecksum, "PTD checksum", 256);
  if (rawCapability.editable && !schemaChecksum) {
    throw new Error("B2B 價格 PTD 可編輯能力缺少 checksum。");
  }
  const quantityDiscountsReason = rawCapability.quantityDiscountsReason === null
    ? null
    : displayText(
      rawCapability.quantityDiscountsReason,
      "數量折扣 PTD 說明",
      4_000,
    );
  const fetchedAt = exactText(source.fetchedAt, "快照時間", 40);
  if (!Number.isFinite(Date.parse(fetchedAt))) {
    throw new Error("B2B 價格快照時間無效。");
  }
  const asin = optionalExactText(source.asin, "ASIN", 10);
  if (asin !== null && !/^[A-Z0-9]{10}$/u.test(asin)) {
    throw new Error("B2B 價格 ASIN 無效。");
  }
  const writeStatus = source.writeStatus === undefined ||
      source.writeStatus === null
    ? null
    : parseBusinessPriceWriteStatus(source.writeStatus);
  if (writeStatus && (
    source.mode !== "live" ||
    writeStatus.marketplaceId !== marketplaceId ||
    writeStatus.sellerSku !== sellerSku ||
    writeStatus.asin !== asin ||
    writeStatus.productType !== source.productType
  )) {
    throw new Error("B2B 價格送出狀態與目前商品識別不一致。");
  }
  if (writeStatus?.status === "VERIFIED" && (
    writeStatus.stage === "business_price"
      ? presence !== "present" ||
        !sameMoney(businessPrice, writeStatus.requestedBusinessPrice) ||
        (writeStatus.requestedMinimumPrice !== null &&
          !sameMoney(
            minimumPriceEvidence.minimumPrice,
            writeStatus.requestedMinimumPrice,
          )) ||
        (writeStatus.quantityDiscountPlanChange === "replace" &&
          (quantityDiscount.presence !== "canonical" ||
            !sameQuantityDiscountPlan(
              quantityDiscount.plan,
              writeStatus.requestedQuantityDiscountPlan,
            )))
      : minimumPriceEvidence.minimumPricePresence !== "canonical" ||
        !sameMoney(
          minimumPriceEvidence.minimumPrice,
          writeStatus.requestedMinimumPrice,
        )
  )) {
    throw new Error("B2B 價格已確認狀態與目前 Amazon 值不一致。");
  }
  return Object.freeze({
    mode: source.mode,
    marketplaceId,
    sellerSku,
    asin,
    title: displayText(source.title, "商品名稱", 2_000, true),
    productType: exactText(source.productType, "商品類型", 120),
    standardPrice,
    minimumPrice: minimumPriceEvidence.minimumPrice,
    minimumPricePresence: minimumPriceEvidence.minimumPricePresence,
    businessPrice,
    businessOfferPresence: presence,
    businessPricingManagedByAutomation:
      source.businessPricingManagedByAutomation,
    quantityDiscountPlan: quantityDiscount.plan,
    quantityDiscountPlanPresence: quantityDiscount.presence,
    quantityDiscountPlanHash: quantityDiscount.hash,
    businessOfferGuardHash: exactHash(
      source.businessOfferGuardHash,
      "offer guard",
    ),
    businessOfferProtectedHash: exactHash(
      source.businessOfferProtectedHash,
      "protected offer",
    ),
    businessPricingCapability: Object.freeze({
      supported: rawCapability.supported,
      editable: rawCapability.editable,
      reason: capabilityReason,
      schemaChecksum,
      quantityDiscountsSupported: rawCapability.quantityDiscountsSupported,
      quantityDiscountsEditable: rawCapability.quantityDiscountsEditable,
      quantityDiscountsReason,
    }),
    fetchedAt,
    notice: optionalExactText(source.notice, "說明", 4_000),
    writeStatus,
  });
}

export function defaultBusinessPricingProposal(
  listing: BusinessPricingListingSnapshot,
): Readonly<{
  businessPrice: number;
  tiers: readonly BusinessQuantityDiscountTier[];
}> | null {
  const standard = listing.standardPrice;
  if (
    !standard ||
    standard.currencyCode !== "USD" ||
    standard.amount <= 1 ||
    listing.businessPricingManagedByAutomation ||
    !listing.businessPricingCapability.supported ||
    !listing.businessPricingCapability.editable
  ) return null;
  const canReplaceQuantityDiscounts =
    listing.quantityDiscountPlanPresence !== "ambiguous" &&
    (listing.quantityDiscountPlanPresence !== "duplicate" ||
      listing.quantityDiscountPlan?.discountType === "percent") &&
    listing.businessPricingCapability.quantityDiscountsSupported &&
    listing.businessPricingCapability.quantityDiscountsEditable;
  const duplicateTiers = listing.quantityDiscountPlanPresence === "duplicate" &&
      listing.quantityDiscountPlan?.discountType === "percent"
    ? listing.quantityDiscountPlan.levels.map((level) => Object.freeze({
        lowerBound: level.lowerBound,
        percent: level.value,
      }))
    : null;
  return Object.freeze({
    businessPrice: duplicateTiers && listing.businessPrice
      ? listing.businessPrice.amount
      : Number((standard.amount - 1).toFixed(2)),
    tiers: Object.freeze(canReplaceQuantityDiscounts
      ? duplicateTiers ?? [
          Object.freeze({ lowerBound: 5, percent: 5 }),
          Object.freeze({ lowerBound: 10, percent: 10 }),
          Object.freeze({ lowerBound: 15, percent: 15 }),
          Object.freeze({ lowerBound: 20, percent: 20 }),
        ]
      : []),
  });
}

export type BusinessPricingEditorMode = "price_only" | "combined";

export function businessPricingEditorProposal(
  listing: BusinessPricingListingSnapshot,
  mode: BusinessPricingEditorMode,
): Readonly<{
  businessPrice: number;
  quantityDiscountTiers?: readonly BusinessQuantityDiscountTier[];
}> | null {
  const proposal = defaultBusinessPricingProposal(listing);
  if (
    !proposal ||
    (mode === "combined" && (
      proposal.tiers.length === 0 ||
      listing.minimumPricePresence === "ambiguous"
    ))
  ) {
    return null;
  }
  return Object.freeze({
    businessPrice: proposal.businessPrice,
    ...(mode === "combined"
      ? { quantityDiscountTiers: proposal.tiers }
      : {}),
  });
}

function requiredMoney(value: unknown, label: string): BusinessPricingMoney {
  const parsed = money(value, label);
  if (!parsed) throw new Error(`B2B 價格的${label}不可為空。`);
  return parsed;
}

function sameMoney(
  left: BusinessPricingMoney | null,
  right: BusinessPricingMoney | null,
): boolean {
  return left === null
    ? right === null
    : right !== null &&
      left.amount === right.amount &&
      left.currencyCode === right.currencyCode;
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

function validateMinimumPriceTransition(input: Readonly<{
  previousMinimumPrice: BusinessPricingMoney | null;
  requestedMinimumPrice: BusinessPricingMoney | null;
  lowestTierUnitPrice: BusinessPricingMoney | null;
  minimumPriceChange: unknown;
  minimumPriceProtectedHash: string | null;
  minimumPriceCanonicalPatchHash: string | null;
  businessPriceValidation: unknown;
}>, completed = false): asserts input is Readonly<{
  previousMinimumPrice: BusinessPricingMoney | null;
  requestedMinimumPrice: BusinessPricingMoney | null;
  lowestTierUnitPrice: BusinessPricingMoney | null;
  minimumPriceChange: "preserve" | "lower";
  minimumPriceProtectedHash: string | null;
  minimumPriceCanonicalPatchHash: string | null;
  businessPriceValidation:
    | "validated"
    | "final-state-validated"
    | "deferred-until-minimum-price";
}> {
  const validation = input.businessPriceValidation;
  if (
    validation !== "validated" &&
    validation !== "final-state-validated" &&
    validation !== "deferred-until-minimum-price"
  ) {
    throw new Error("B2B 價格的最低價預檢證據無效。");
  }
  if (input.minimumPriceChange === "preserve") {
    if (
      !sameMoney(input.previousMinimumPrice, input.requestedMinimumPrice) ||
      input.minimumPriceProtectedHash !== null ||
      input.minimumPriceCanonicalPatchHash !== null ||
      validation !== "validated"
    ) {
      throw new Error("B2B 價格的最低價保留證據不一致。");
    }
    return;
  }
  if (input.minimumPriceChange !== "lower") {
    throw new Error("B2B 價格的最低價操作無效。");
  }
  const previous = input.previousMinimumPrice;
  const requested = input.requestedMinimumPrice;
  const lowest = input.lowestTierUnitPrice;
  if (
    !previous ||
    !requested ||
    !lowest ||
    previous.currencyCode !== "USD" ||
    requested.currencyCode !== "USD" ||
    lowest.currencyCode !== "USD" ||
    requested.amount >= previous.amount ||
    Math.round(requested.amount * 100) !==
      Math.round(lowest.amount * 100) - 100 ||
    !input.minimumPriceProtectedHash ||
    !input.minimumPriceCanonicalPatchHash ||
    validation !== (completed ? "validated" : "final-state-validated")
  ) {
    throw new Error("B2B 價格的最低價調整證據不一致。");
  }
}

function exactIso(value: unknown, label: string): string {
  const parsed = exactText(value, label, 40);
  if (!Number.isFinite(Date.parse(parsed))) {
    throw new Error(`B2B 價格的${label}無效。`);
  }
  return parsed;
}

function parseIssues(value: unknown): readonly BusinessPriceIssue[] {
  if (!Array.isArray(value) || value.length > 100) {
    throw new Error("B2B 價格的 Amazon issues 無效。");
  }
  return Object.freeze(value.map((entry) => {
    const issue = record(entry);
    return Object.freeze({
      severity: exactText(issue.severity, "issue severity", 40),
      message: displayText(issue.message, "issue message", 4_000),
    });
  }));
}

function responseQuantityDiscountPlan(
  value: unknown,
  label: string,
): BusinessQuantityDiscountPlan | null {
  if (value === null) return null;
  try {
    return parseQuantityDiscountPlan(
      value,
      "canonical",
      "0".repeat(64),
    ).plan;
  } catch {
    throw new Error(`B2B 價格的${label}無法安全辨識。`);
  }
}

export function parseBusinessPriceWriteStatus(
  value: unknown,
): BusinessPriceWriteStatus {
  const source = record(value);
  if (source.mode !== "live" ||
      (source.status !== "PROCESSING" && source.status !== "VERIFIED") ||
      (source.stage !== "minimum_price" &&
        source.stage !== "business_price") ||
      source.canResend !== false ||
      typeof source.verified !== "boolean" ||
      typeof source.authoritative !== "boolean" ||
      typeof source.businessPriceSubmitted !== "boolean") {
    throw new Error("B2B 價格送出狀態無法安全辨識。");
  }
  const verifiedAt = source.verifiedAt === null
    ? null
    : exactIso(source.verifiedAt, "回查完成時間");
  if (
    (source.status === "PROCESSING" &&
      (source.verified || source.authoritative || verifiedAt !== null)) ||
    (source.status === "VERIFIED" &&
      (!source.verified || !source.authoritative || verifiedAt === null)) ||
    source.businessPriceSubmitted !== (source.stage === "business_price")
  ) {
    throw new Error("B2B 價格送出狀態與回查證據不一致。");
  }
  const previousBusinessPrice = money(
    source.previousBusinessPrice,
    "送出前 B2B 價格",
  );
  const requestedBusinessPrice = money(
    source.requestedBusinessPrice,
    "送出目標 B2B 價格",
  );
  const previousMinimumPrice = money(
    source.previousMinimumPrice,
    "送出前最低價",
  );
  const requestedMinimumPrice = money(
    source.requestedMinimumPrice,
    "送出目標最低價",
  );
  const lowestTierUnitPrice = money(
    source.lowestTierUnitPrice,
    "送出最低階梯單價",
  );
  const previousQuantityDiscountPlan = responseQuantityDiscountPlan(
    source.previousQuantityDiscountPlan,
    "送出前數量折扣",
  );
  const requestedQuantityDiscountPlan = responseQuantityDiscountPlan(
    source.requestedQuantityDiscountPlan,
    "送出目標數量折扣",
  );
  const quantityDiscountPlanChange = source.quantityDiscountPlanChange;
  if (
    quantityDiscountPlanChange !== null &&
    quantityDiscountPlanChange !== "preserve" &&
    quantityDiscountPlanChange !== "replace"
  ) {
    throw new Error("B2B 價格送出的數量折扣狀態無效。");
  }
  if (
    (source.stage === "business_price" && !requestedBusinessPrice) ||
    (source.stage === "minimum_price" && !requestedMinimumPrice) ||
    (quantityDiscountPlanChange === "preserve" &&
      !sameQuantityDiscountPlan(
        previousQuantityDiscountPlan,
        requestedQuantityDiscountPlan,
      )) ||
    (quantityDiscountPlanChange === "replace" &&
      requestedQuantityDiscountPlan?.discountType !== "percent")
  ) {
    throw new Error("B2B 價格送出的目標值證據不一致。");
  }
  const currencyCodes = [
    previousBusinessPrice,
    requestedBusinessPrice,
    previousMinimumPrice,
    requestedMinimumPrice,
    lowestTierUnitPrice,
  ].filter((entry): entry is BusinessPricingMoney => entry !== null)
    .map((entry) => entry.currencyCode);
  if (new Set(currencyCodes).size > 1) {
    throw new Error("B2B 價格送出狀態的幣別不一致。");
  }
  const asin = exactText(source.asin, "送出 ASIN", 10);
  if (!/^[A-Z0-9]{10}$/u.test(asin)) {
    throw new Error("B2B 價格送出 ASIN 無效。");
  }
  return Object.freeze({
    mode: "live",
    status: source.status,
    stage: source.stage,
    marketplaceId: exactText(source.marketplaceId, "送出站點", 32),
    sellerSku: exactText(source.sellerSku, "送出 Seller SKU", 40),
    asin,
    productType: exactText(source.productType, "送出商品類型", 120),
    acceptedAt: exactIso(source.acceptedAt, "Amazon 接受時間"),
    verifiedAt,
    requestId: optionalExactText(source.requestId, "送出 Request ID", 512),
    submissionId: optionalExactText(
      source.submissionId,
      "送出 Submission ID",
      512,
    ),
    verified: source.verified,
    authoritative: source.authoritative,
    canResend: false,
    businessPriceSubmitted: source.businessPriceSubmitted,
    previousBusinessPrice,
    requestedBusinessPrice,
    previousMinimumPrice,
    requestedMinimumPrice,
    lowestTierUnitPrice,
    previousQuantityDiscountPlan,
    requestedQuantityDiscountPlan,
    quantityDiscountPlanChange,
    notice: displayText(source.notice, "送出狀態說明", 4_000),
  });
}

function sameQuantityDiscountPlan(
  left: BusinessQuantityDiscountPlan | null,
  right: BusinessQuantityDiscountPlan | null,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function parseBusinessPriceValidation(
  value: unknown,
): BusinessPriceValidation {
  const source = record(value);
  const mode = source.mode;
  const status = source.status;
  if (mode !== "live" && mode !== "demo") {
    throw new Error("B2B 價格預檢狀態無效。");
  }
  let parsedStatus: "VALID" | "SIMULATED";
  if (mode === "live") {
    if (status !== "VALID") {
      throw new Error("B2B 價格預檢狀態無效。");
    }
    parsedStatus = "VALID";
  } else {
    if (status !== "SIMULATED") {
      throw new Error("B2B 價格預檢狀態無效。");
    }
    parsedStatus = "SIMULATED";
  }
  const asin = exactText(source.asin, "預檢 ASIN", 10);
  if (!/^[A-Z0-9]{10}$/u.test(asin)) {
    throw new Error("B2B 價格預檢 ASIN 無效。");
  }
  const previousMinimumPrice = money(
    source.previousMinimumPrice,
    "預檢舊最低允許售價",
  );
  const requestedMinimumPrice = money(
    source.requestedMinimumPrice,
    "預檢新最低允許售價",
  );
  const lowestTierUnitPrice = money(
    source.lowestTierUnitPrice,
    "預檢最低階梯實際單價",
  );
  const minimumPriceProtectedHash = optionalExactHash(
    source.minimumPriceProtectedHash,
    "預檢最低價 protected offer",
  );
  const minimumPriceCanonicalPatchHash = optionalExactHash(
    source.minimumPriceCanonicalPatchHash,
    "預檢最低價 patch",
  );
  const minimumPriceTransition = {
    previousMinimumPrice,
    requestedMinimumPrice,
    lowestTierUnitPrice,
    minimumPriceChange: source.minimumPriceChange,
    minimumPriceProtectedHash,
    minimumPriceCanonicalPatchHash,
    businessPriceValidation: source.businessPriceValidation,
  };
  validateMinimumPriceTransition(minimumPriceTransition);
  const previousQuantityDiscountPlan = responseQuantityDiscountPlan(
    source.previousQuantityDiscountPlan,
    "預檢舊數量折扣",
  );
  const requestedQuantityDiscountPlan = responseQuantityDiscountPlan(
    source.requestedQuantityDiscountPlan,
    "預檢新數量折扣",
  );
  const quantityDiscountPlanChange = source.quantityDiscountPlanChange;
  const quantityDiscountPlanPresence =
    source.quantityDiscountPlanPresence === "absent" ||
      source.quantityDiscountPlanPresence === "canonical" ||
      source.quantityDiscountPlanPresence === "duplicate" ||
      source.quantityDiscountPlanPresence === "ambiguous"
      ? source.quantityDiscountPlanPresence
      : previousQuantityDiscountPlan === null
        ? "absent"
        : "canonical";
  const previousQuantityDiscountPlanHash = source.previousQuantityDiscountPlanHash ===
      null
    ? null
    : exactHash(
      source.previousQuantityDiscountPlanHash,
      "預檢舊數量折扣 hash",
    );
  if (
    quantityDiscountPlanChange !== "preserve" &&
    quantityDiscountPlanChange !== "replace"
  ) {
    throw new Error("B2B 價格的預檢數量折扣操作無效。");
  }
  if (
    (quantityDiscountPlanChange === "preserve" &&
      !sameQuantityDiscountPlan(
        previousQuantityDiscountPlan,
        requestedQuantityDiscountPlan,
      )) ||
    (quantityDiscountPlanChange === "replace" &&
      requestedQuantityDiscountPlan?.discountType !== "percent")
  ) {
    throw new Error("B2B 價格的預檢數量折扣證據不一致。");
  }
  if ((previousQuantityDiscountPlan === null) !==
      (previousQuantityDiscountPlanHash === null)) {
    throw new Error("B2B 價格的預檢舊數量折扣 hash 不一致。");
  }
  return Object.freeze({
    mode,
    status: parsedStatus,
    marketplaceId: exactText(source.marketplaceId, "預檢站點", 32),
    sellerSku: exactText(source.sellerSku, "預檢 Seller SKU", 40),
    asin,
    productType: exactText(source.productType, "預檢商品類型", 120),
    standardPrice: requiredMoney(source.standardPrice, "預檢一般售價"),
    previousBusinessPrice: money(source.previousBusinessPrice, "預檢舊 B2B 價格"),
    requestedBusinessPrice: requiredMoney(
      source.requestedBusinessPrice,
      "預檢新 B2B 價格",
    ),
    ...minimumPriceTransition,
    previousQuantityDiscountPlan,
    previousQuantityDiscountPlanHash,
    requestedQuantityDiscountPlan,
    quantityDiscountPlanPresence,
    quantityDiscountPlanChange,
    businessOfferGuardHash: exactHash(
      source.businessOfferGuardHash,
      "預檢 offer guard",
    ),
    businessOfferProtectedHash: exactHash(
      source.businessOfferProtectedHash,
      "預檢 protected offer",
    ),
    schemaChecksum: exactText(source.schemaChecksum, "預檢 PTD checksum", 256),
    fbaEvidenceHash: exactHash(source.fbaEvidenceHash, "預檢 FBA 證據"),
    canonicalPatchHash: exactHash(source.canonicalPatchHash, "預檢 patch"),
    validationIssuesHash: exactHash(
      source.validationIssuesHash,
      "預檢 issues",
    ),
    validatedAt: exactIso(source.validatedAt, "預檢時間"),
    issues: parseIssues(source.issues),
    notice: displayText(source.notice, "預檢說明", 4_000),
  });
}

export function createSubmittedBusinessPricePreview(input: {
  listing: BusinessPricingListingSnapshot;
  newBusinessPrice: number;
  quantityDiscountTiers?: readonly BusinessQuantityDiscountTier[];
  idempotencyKey: string;
  response: unknown;
}): SubmittedBusinessPricePreview {
  if (
    !input.listing.asin ||
    !input.listing.standardPrice ||
    !input.listing.businessPricingCapability.supported ||
    !input.listing.businessPricingCapability.editable ||
    !input.listing.businessPricingCapability.schemaChecksum ||
    !Number.isFinite(input.newBusinessPrice) ||
    input.newBusinessPrice <= 0 ||
    !/^[A-Za-z0-9-]{8,80}$/u.test(input.idempotencyKey)
  ) {
    throw new Error("B2B 價格預檢送出資料無效。");
  }
  const currency = input.listing.standardPrice.currencyCode;
  const tiers = input.quantityDiscountTiers;
  let requestedPlan: BusinessQuantityDiscountPlan | null = null;
  if (
    tiers === undefined &&
    (input.listing.quantityDiscountPlanPresence === "ambiguous" ||
      input.listing.quantityDiscountPlanPresence === "duplicate")
  ) {
    throw new Error("目前 B2B 數量折扣不能安全地只改價格。");
  }
  if (tiers !== undefined) {
    if (
      input.listing.minimumPricePresence === "ambiguous" ||
      input.listing.quantityDiscountPlanPresence === "ambiguous" ||
      (input.listing.quantityDiscountPlanPresence === "duplicate" &&
        input.listing.quantityDiscountPlan?.discountType !== "percent") ||
      !input.listing.businessPricingCapability.quantityDiscountsSupported ||
      !input.listing.businessPricingCapability.quantityDiscountsEditable ||
      tiers.length < 1 || tiers.length > 5
    ) {
      throw new Error("B2B 數量折扣預檢送出資料無效。");
    }
    const levels = tiers.map((tier, index) => {
      const previous = tiers[index - 1];
      if (
        !Number.isSafeInteger(tier.lowerBound) || tier.lowerBound <= 0 ||
        !Number.isFinite(tier.percent) || tier.percent <= 0 ||
        tier.percent >= 100 ||
        Number(tier.percent.toFixed(2)) !== tier.percent ||
        (previous !== undefined &&
          (tier.lowerBound <= previous.lowerBound ||
            tier.percent <= previous.percent))
      ) {
        throw new Error("B2B 數量折扣必須是 1–5 階，件數與折扣需嚴格遞增。");
      }
      const unitPrice = currency === "USD"
        ? usdPercentTierAmount(input.newBusinessPrice, tier.percent)
        : Number((
            input.newBusinessPrice * (1 - tier.percent / 100)
          ).toFixed(currency === "JPY" ? 0 : 2));
      const previousUnitPrice = previous === undefined
        ? input.newBusinessPrice
        : currency === "USD"
        ? usdPercentTierAmount(input.newBusinessPrice, previous.percent)
        : Number((
            input.newBusinessPrice * (1 - previous.percent / 100)
          ).toFixed(currency === "JPY" ? 0 : 2));
      if (unitPrice <= 0 || unitPrice >= previousUnitPrice) {
        throw new Error("B2B 數量折扣在 USD 兩位小數後必須逐階降低單價。");
      }
      return Object.freeze({
        lowerBound: tier.lowerBound,
        value: tier.percent,
      });
    });
    requestedPlan = Object.freeze({
      discountType: "percent" as const,
      levels: Object.freeze(levels),
    });
  }
  const expectedLowestTierUnitPrice = tiers === undefined
    ? null
    : Object.freeze({
        amount: currency === "USD"
          ? usdPercentTierAmount(
              input.newBusinessPrice,
              tiers.at(-1)!.percent,
            )
          : Number((
              input.newBusinessPrice *
              (1 - tiers.at(-1)!.percent / 100)
            ).toFixed(currency === "JPY" ? 0 : 2)),
        currencyCode: currency,
      });
  const shouldLowerMinimumPrice = Boolean(
    expectedLowestTierUnitPrice &&
    input.listing.minimumPrice &&
    input.listing.minimumPrice.amount > expectedLowestTierUnitPrice.amount,
  );
  const expectedRequestedMinimumPrice = shouldLowerMinimumPrice
    ? Object.freeze({
        amount: (Math.round(expectedLowestTierUnitPrice!.amount * 100) - 100) /
          100,
        currencyCode: currency,
      })
    : input.listing.minimumPrice;
  const body = Object.freeze({
    marketplaceId: input.listing.marketplaceId,
    sellerSku: input.listing.sellerSku,
    expectedStandardPrice: input.listing.standardPrice.amount,
    expectedBusinessPrice: input.listing.businessPrice?.amount ?? null,
    newBusinessPrice: input.newBusinessPrice,
    ...(tiers === undefined ? {} : {
      expectedMinimumPrice: input.listing.minimumPrice?.amount ?? null,
      expectedQuantityDiscountPlanHash:
        input.listing.quantityDiscountPlanHash,
      quantityDiscountTiers: Object.freeze(tiers.map((tier) =>
        Object.freeze({ ...tier })
      )),
    }),
    idempotencyKey: input.idempotencyKey,
  });
  const validation = parseBusinessPriceValidation(input.response);
  if (
    validation.marketplaceId !== body.marketplaceId ||
    validation.sellerSku !== body.sellerSku ||
    validation.asin !== input.listing.asin ||
    validation.productType !== input.listing.productType ||
    validation.businessOfferGuardHash !== input.listing.businessOfferGuardHash ||
    validation.businessOfferProtectedHash !==
      input.listing.businessOfferProtectedHash ||
    validation.schemaChecksum !==
      input.listing.businessPricingCapability.schemaChecksum ||
    !sameMoney(validation.standardPrice, input.listing.standardPrice) ||
    !sameMoney(validation.previousBusinessPrice, input.listing.businessPrice) ||
    !sameMoney(validation.previousMinimumPrice, input.listing.minimumPrice) ||
    !sameMoney(
      validation.requestedMinimumPrice,
      expectedRequestedMinimumPrice,
    ) ||
    !sameMoney(
      validation.lowestTierUnitPrice,
      expectedLowestTierUnitPrice,
    ) ||
    validation.minimumPriceChange !==
      (shouldLowerMinimumPrice ? "lower" : "preserve") ||
    validation.businessPriceValidation !==
      (shouldLowerMinimumPrice ? "final-state-validated" : "validated") ||
    validation.requestedBusinessPrice.amount !== body.newBusinessPrice ||
    validation.requestedBusinessPrice.currencyCode !== currency ||
    !sameQuantityDiscountPlan(
      validation.previousQuantityDiscountPlan,
      input.listing.quantityDiscountPlan,
    ) ||
    validation.previousQuantityDiscountPlanHash !==
      input.listing.quantityDiscountPlanHash ||
    validation.quantityDiscountPlanPresence !==
      input.listing.quantityDiscountPlanPresence ||
    validation.quantityDiscountPlanChange !==
      (tiers === undefined ? "preserve" : "replace") ||
    !sameQuantityDiscountPlan(
      validation.requestedQuantityDiscountPlan,
      tiers === undefined ? input.listing.quantityDiscountPlan : requestedPlan,
    )
  ) {
    throw new Error("Amazon B2B 價格預檢回應與送出快照不一致。");
  }
  return Object.freeze({ body, validation });
}

export function parseBusinessPriceUpdate(
  value: unknown,
  submitted: SubmittedBusinessPricePreview,
): BusinessPriceUpdate {
  const source = record(value);
  const mode = source.mode;
  const status = source.status;
  if (mode !== "live" && mode !== "demo") {
    throw new Error("B2B 價格更新狀態無效。");
  }
  let parsedStatus: "ACCEPTED" | "SIMULATED";
  if (mode === "live") {
    if (status !== "ACCEPTED") {
      throw new Error("B2B 價格更新狀態無效。");
    }
    parsedStatus = "ACCEPTED";
  } else {
    if (status !== "SIMULATED") {
      throw new Error("B2B 價格更新狀態無效。");
    }
    parsedStatus = "SIMULATED";
  }
  const asin = exactText(source.asin, "更新 ASIN", 10);
  const standardPrice = requiredMoney(source.standardPrice, "更新一般售價");
  const previousBusinessPrice = money(
    source.previousBusinessPrice,
    "更新舊 B2B 價格",
  );
  const requestedBusinessPrice = requiredMoney(
    source.requestedBusinessPrice,
    "更新新 B2B 價格",
  );
  const previousMinimumPrice = money(
    source.previousMinimumPrice,
    "更新舊最低允許售價",
  );
  const requestedMinimumPrice = money(
    source.requestedMinimumPrice,
    "更新新最低允許售價",
  );
  const lowestTierUnitPrice = money(
    source.lowestTierUnitPrice,
    "更新最低階梯實際單價",
  );
  const minimumPriceProtectedHash = optionalExactHash(
    source.minimumPriceProtectedHash,
    "更新最低價 protected offer",
  );
  const minimumPriceCanonicalPatchHash = optionalExactHash(
    source.minimumPriceCanonicalPatchHash,
    "更新最低價 patch",
  );
  const minimumPriceTransition = {
    previousMinimumPrice,
    requestedMinimumPrice,
    lowestTierUnitPrice,
    minimumPriceChange: source.minimumPriceChange,
    minimumPriceProtectedHash,
    minimumPriceCanonicalPatchHash,
    businessPriceValidation: source.businessPriceValidation,
  };
  validateMinimumPriceTransition(minimumPriceTransition, true);
  if (minimumPriceTransition.businessPriceValidation !== "validated") {
    throw new Error("B2B 價格更新尚未完成正式回查驗證。");
  }
  const previousQuantityDiscountPlan = responseQuantityDiscountPlan(
    source.previousQuantityDiscountPlan,
    "更新舊數量折扣",
  );
  const requestedQuantityDiscountPlan = responseQuantityDiscountPlan(
    source.requestedQuantityDiscountPlan,
    "更新新數量折扣",
  );
  const previousQuantityDiscountPlanHash = source.previousQuantityDiscountPlanHash ===
      null
    ? null
    : exactHash(
      source.previousQuantityDiscountPlanHash,
      "更新舊數量折扣 hash",
    );
  const quantityDiscountPlanChange = source.quantityDiscountPlanChange;
  if (
    (quantityDiscountPlanChange !== "preserve" &&
      quantityDiscountPlanChange !== "replace") ||
    (previousQuantityDiscountPlan === null) !==
      (previousQuantityDiscountPlanHash === null) ||
    (quantityDiscountPlanChange === "preserve" &&
      !sameQuantityDiscountPlan(
        previousQuantityDiscountPlan,
        requestedQuantityDiscountPlan,
      )) ||
    (quantityDiscountPlanChange === "replace" &&
      requestedQuantityDiscountPlan?.discountType !== "percent")
  ) {
    throw new Error("B2B 價格更新的數量折扣證據不一致。");
  }
  const businessOfferGuardHash = exactHash(
    source.businessOfferGuardHash,
    "更新 offer guard",
  );
  const businessOfferProtectedHash = exactHash(
    source.businessOfferProtectedHash,
    "更新 protected offer",
  );
  const schemaChecksum = exactText(
    source.schemaChecksum,
    "更新 PTD checksum",
    256,
  );
  const lifecycle = record(source.writeLifecycle);
  if (
    lifecycle.state !== "verified" ||
    lifecycle.verified !== true ||
    lifecycle.authoritative !== true ||
    !Number.isSafeInteger(lifecycle.attempts) ||
    Number(lifecycle.attempts) < 0 ||
    Number(lifecycle.attempts) > 100
  ) {
    throw new Error("B2B 價格更新缺少主程序權威回查證據。");
  }
  const acceptedAt = exactIso(source.acceptedAt, "更新接受時間");
  if (
    exactIso(lifecycle.acceptedAt, "回查接受時間") !== acceptedAt ||
    !exactIso(lifecycle.verifiedAt, "回查完成時間")
  ) {
    throw new Error("B2B 價格更新回查時間無效。");
  }
  const validation = submitted.validation;
  if (
    source.marketplaceId !== submitted.body.marketplaceId ||
    source.sellerSku !== submitted.body.sellerSku ||
    asin !== validation.asin ||
    source.productType !== validation.productType ||
    (validation.minimumPriceChange === "preserve" &&
      (businessOfferGuardHash !== validation.businessOfferGuardHash ||
        businessOfferProtectedHash !==
          validation.businessOfferProtectedHash)) ||
    schemaChecksum !== validation.schemaChecksum ||
    !sameMoney(standardPrice, validation.standardPrice) ||
    !sameMoney(previousBusinessPrice, validation.previousBusinessPrice) ||
    !sameMoney(previousMinimumPrice, validation.previousMinimumPrice) ||
    !sameMoney(requestedMinimumPrice, validation.requestedMinimumPrice) ||
    !sameMoney(lowestTierUnitPrice, validation.lowestTierUnitPrice) ||
    minimumPriceTransition.minimumPriceChange !==
      validation.minimumPriceChange ||
    minimumPriceProtectedHash !== validation.minimumPriceProtectedHash ||
    minimumPriceCanonicalPatchHash !==
      validation.minimumPriceCanonicalPatchHash ||
    requestedBusinessPrice.amount !== submitted.body.newBusinessPrice ||
    requestedBusinessPrice.currencyCode !== standardPrice.currencyCode ||
    !sameQuantityDiscountPlan(
      previousQuantityDiscountPlan,
      validation.previousQuantityDiscountPlan,
    ) ||
    previousQuantityDiscountPlanHash !==
      validation.previousQuantityDiscountPlanHash ||
    !sameQuantityDiscountPlan(
      requestedQuantityDiscountPlan,
      validation.requestedQuantityDiscountPlan,
    ) ||
    quantityDiscountPlanChange !== validation.quantityDiscountPlanChange
  ) {
    throw new Error("Amazon B2B 價格更新識別或價格與預檢快照不一致。");
  }
  return Object.freeze({
    mode,
    status: parsedStatus,
    marketplaceId: exactText(source.marketplaceId, "更新站點", 32),
    sellerSku: exactText(source.sellerSku, "更新 Seller SKU", 40),
    asin,
    productType: exactText(source.productType, "更新商品類型", 120),
    standardPrice,
    previousBusinessPrice,
    requestedBusinessPrice,
    ...minimumPriceTransition,
    businessPriceValidation: "validated" as const,
    previousQuantityDiscountPlan,
    previousQuantityDiscountPlanHash,
    requestedQuantityDiscountPlan,
    quantityDiscountPlanChange,
    businessOfferGuardHash,
    businessOfferProtectedHash,
    schemaChecksum,
    acceptedAt,
    issues: parseIssues(source.issues),
    notice: displayText(source.notice, "更新說明", 4_000),
  });
}

export function parseBusinessPriceProcessing(
  value: unknown,
  submitted: SubmittedBusinessPricePreview,
): BusinessPriceWriteStatus {
  const status = parseBusinessPriceWriteStatus(value);
  const validation = submitted.validation;
  if (
    status.status !== "PROCESSING" ||
    status.marketplaceId !== submitted.body.marketplaceId ||
    status.sellerSku !== submitted.body.sellerSku ||
    status.asin !== validation.asin ||
    status.productType !== validation.productType ||
    !sameMoney(status.previousBusinessPrice, validation.previousBusinessPrice) ||
    !sameMoney(status.requestedBusinessPrice, validation.requestedBusinessPrice) ||
    !sameMoney(status.previousMinimumPrice, validation.previousMinimumPrice) ||
    !sameMoney(status.requestedMinimumPrice, validation.requestedMinimumPrice) ||
    !sameMoney(status.lowestTierUnitPrice, validation.lowestTierUnitPrice) ||
    !sameQuantityDiscountPlan(
      status.previousQuantityDiscountPlan,
      validation.previousQuantityDiscountPlan,
    ) ||
    !sameQuantityDiscountPlan(
      status.requestedQuantityDiscountPlan,
      validation.requestedQuantityDiscountPlan,
    ) ||
    status.quantityDiscountPlanChange !==
      validation.quantityDiscountPlanChange ||
    (status.stage === "minimum_price" &&
      validation.minimumPriceChange !== "lower")
  ) {
    throw new Error("Amazon B2B 價格處理狀態與送出快照不一致。");
  }
  return status;
}
