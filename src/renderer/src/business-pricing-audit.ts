export type BusinessPricingAuditStatus =
  | "configured"
  | "above_standard"
  | "missing"
  | "unsupported"
  | "incomplete";

export type BusinessPricingAuditFilter =
  | "all"
  | "problem"
  | BusinessPricingAuditStatus;

export type BusinessPricingMoney = Readonly<{
  amount: number;
  currencyCode: string;
}>;

export type BusinessPricingAuditRow = Readonly<{
  sellerSku: string;
  asin: string;
  title: string;
  productType: string;
  standardPrice: BusinessPricingMoney | null;
  businessPrice: BusinessPricingMoney | null;
  businessOfferPresence: "absent" | "present" | "ambiguous";
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
}>;

export type BusinessPricingAuditSnapshot = Readonly<{
  mode: "live" | "demo";
  marketplaceId: string;
  fetchedAt: string;
  rows: readonly BusinessPricingAuditRow[];
  summary: BusinessPricingAuditSummary;
  notice: string;
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
  businessPrice: BusinessPricingMoney | null;
  businessOfferPresence: "absent" | "present" | "ambiguous";
  businessPricingManagedByAutomation: boolean;
  quantityDiscountPlan: BusinessQuantityDiscountPlan | null;
  quantityDiscountPlanPresence: "absent" | "canonical" | "ambiguous";
  quantityDiscountPlanHash: string | null;
  businessOfferGuardHash: string;
  businessOfferProtectedHash: string;
  businessPricingCapability: BusinessPricingCapability;
  fetchedAt: string;
  notice: string | null;
}>;

export type BusinessPriceWriteBody = Readonly<{
  marketplaceId: string;
  sellerSku: string;
  expectedStandardPrice: number;
  expectedBusinessPrice: number | null;
  newBusinessPrice: number;
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
  previousQuantityDiscountPlan: BusinessQuantityDiscountPlan | null;
  previousQuantityDiscountPlanHash: string | null;
  requestedQuantityDiscountPlan: BusinessQuantityDiscountPlan | null;
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
  if (
    ((status === "configured" || status === "above_standard") &&
      (presence !== "present" || !businessPrice)) ||
    (status === "missing" && (presence !== "absent" || businessPrice !== null)) ||
    (source.editable && status !== "configured" &&
      status !== "above_standard" && status !== "missing") ||
    (status === "configured" &&
      (!standardPrice || !businessPrice ||
        businessPrice.amount > standardPrice.amount)) ||
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
    status,
    editable: source.editable,
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
  };
  const actual = {
    configured: rows.filter((row) => row.status === "configured").length,
    aboveStandard: rows.filter((row) => row.status === "above_standard").length,
    missing: rows.filter((row) => row.status === "missing").length,
    unsupported: rows.filter((row) => row.status === "unsupported").length,
    incomplete: rows.filter((row) => row.status === "incomplete").length,
  };
  if (
    summary.totalFbaSkuCount !== rows.length ||
    summary.configured !== actual.configured ||
    summary.aboveStandard !== actual.aboveStandard ||
    summary.missing !== actual.missing ||
    summary.unsupported !== actual.unsupported ||
    summary.incomplete !== actual.incomplete
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
  if (filter === "problem") return row.status !== "configured";
  if (filter === "unsupported") {
    return !row.editable && row.status !== "incomplete";
  }
  return row.status === filter;
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
  const rows = snapshot.rows.map((row) =>
    row.sellerSku === update.sellerSku
      ? {
          ...row,
          asin: update.asin,
          productType: update.productType,
          standardPrice: update.standardPrice,
          businessPrice: update.requestedBusinessPrice,
          businessOfferPresence: "present" as const,
          status: aboveStandard ? "above_standard" as const : "configured" as const,
          reason: aboveStandard
            ? "Amazon Business 價格仍高於一般售價；主程序已唯讀回查確認。"
            : "已設定 Amazon Business 價格，且主程序唯讀回查確認。",
        }
      : row
  );
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

function parseQuantityDiscountPlan(
  value: unknown,
  presence: unknown,
  hash: unknown,
): {
  plan: BusinessQuantityDiscountPlan | null;
  presence: "absent" | "canonical" | "ambiguous";
  hash: string | null;
} {
  if (presence !== "absent" && presence !== "canonical" &&
      presence !== "ambiguous") {
    throw new Error("B2B 數量折扣證據無效。");
  }
  if (presence === "absent") {
    if (value !== null || hash !== null) {
      throw new Error("B2B 數量折扣空值證據不一致。");
    }
    return { plan: null, presence, hash: null };
  }
  if (presence === "ambiguous") {
    if (value !== null || hash !== null) {
      throw new Error("B2B 數量折扣不明證據不一致。");
    }
    return { plan: null, presence, hash: null };
  }
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
  return {
    plan: Object.freeze({ discountType: source.discountType, levels }),
    presence,
    hash: exactHash(hash, "數量折扣 hash"),
  };
}

export function parseBusinessPricingListingSnapshot(
  value: unknown,
): BusinessPricingListingSnapshot {
  const source = record(value);
  if (source.mode !== "live" && source.mode !== "demo") {
    throw new Error("B2B 價格資料模式無效。");
  }
  const presence = source.businessOfferPresence;
  if (presence !== "absent" && presence !== "present" && presence !== "ambiguous") {
    throw new Error("B2B 價格 offer 證據無效。");
  }
  const standardPrice = money(source.standardPrice, "標準售價");
  const businessPrice = money(source.businessPrice, "B2B 價格");
  const quantityDiscount = parseQuantityDiscountPlan(
    source.quantityDiscountPlan,
    source.quantityDiscountPlanPresence,
    source.quantityDiscountPlanHash,
  );
  if (
    (presence === "present" && !businessPrice) ||
    (presence === "absent" && businessPrice !== null) ||
    (standardPrice && businessPrice &&
      standardPrice.currencyCode !== businessPrice.currencyCode)
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
  return Object.freeze({
    mode: source.mode,
    marketplaceId: exactText(source.marketplaceId, "站點", 32),
    sellerSku: exactText(source.sellerSku, "Seller SKU", 40),
    asin,
    title: displayText(source.title, "商品名稱", 2_000, true),
    productType: exactText(source.productType, "商品類型", 120),
    standardPrice,
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
    listing.businessPricingCapability.quantityDiscountsSupported &&
    listing.businessPricingCapability.quantityDiscountsEditable;
  return Object.freeze({
    businessPrice: Number((standard.amount - 1).toFixed(2)),
    tiers: Object.freeze(canReplaceQuantityDiscounts
      ? [
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
  if (!proposal || (mode === "combined" && proposal.tiers.length === 0)) {
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
  const previousQuantityDiscountPlan = responseQuantityDiscountPlan(
    source.previousQuantityDiscountPlan,
    "預檢舊數量折扣",
  );
  const requestedQuantityDiscountPlan = responseQuantityDiscountPlan(
    source.requestedQuantityDiscountPlan,
    "預檢新數量折扣",
  );
  const quantityDiscountPlanChange = source.quantityDiscountPlanChange;
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
    previousQuantityDiscountPlan,
    previousQuantityDiscountPlanHash,
    requestedQuantityDiscountPlan,
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
  const tiers = input.quantityDiscountTiers;
  let requestedPlan: BusinessQuantityDiscountPlan | null = null;
  if (tiers !== undefined) {
    if (
      input.listing.quantityDiscountPlanPresence === "ambiguous" ||
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
      const unitPrice = Number((
        input.newBusinessPrice * (1 - tier.percent / 100)
      ).toFixed(2));
      const previousUnitPrice = previous === undefined
        ? input.newBusinessPrice
        : Number((
          input.newBusinessPrice * (1 - previous.percent / 100)
        ).toFixed(2));
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
  const body = Object.freeze({
    marketplaceId: input.listing.marketplaceId,
    sellerSku: input.listing.sellerSku,
    expectedStandardPrice: input.listing.standardPrice.amount,
    expectedBusinessPrice: input.listing.businessPrice?.amount ?? null,
    newBusinessPrice: input.newBusinessPrice,
    ...(tiers === undefined ? {} : {
      expectedQuantityDiscountPlanHash:
        input.listing.quantityDiscountPlanHash,
      quantityDiscountTiers: Object.freeze(tiers.map((tier) =>
        Object.freeze({ ...tier })
      )),
    }),
    idempotencyKey: input.idempotencyKey,
  });
  const validation = parseBusinessPriceValidation(input.response);
  const currency = input.listing.standardPrice.currencyCode;
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
    validation.requestedBusinessPrice.amount !== body.newBusinessPrice ||
    validation.requestedBusinessPrice.currencyCode !== currency ||
    !sameQuantityDiscountPlan(
      validation.previousQuantityDiscountPlan,
      input.listing.quantityDiscountPlan,
    ) ||
    validation.previousQuantityDiscountPlanHash !==
      input.listing.quantityDiscountPlanHash ||
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
    businessOfferGuardHash !== validation.businessOfferGuardHash ||
    businessOfferProtectedHash !== validation.businessOfferProtectedHash ||
    schemaChecksum !== validation.schemaChecksum ||
    !sameMoney(standardPrice, validation.standardPrice) ||
    !sameMoney(previousBusinessPrice, validation.previousBusinessPrice) ||
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
