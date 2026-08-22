export type BusinessPricingAuditStatus =
  | "configured"
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
  businessOfferGuardHash: string;
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
  businessOfferGuardHash: string;
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
    (status === "configured" && (presence !== "present" || !businessPrice)) ||
    (status === "missing" && (presence !== "absent" || businessPrice !== null)) ||
    (source.editable && status !== "configured" && status !== "missing")
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
    missing: count(rawSummary.missing, "未設定"),
    unsupported: count(rawSummary.unsupported, "不支援"),
    incomplete: count(rawSummary.incomplete, "資料未完成"),
  };
  const actual = {
    configured: rows.filter((row) => row.status === "configured").length,
    missing: rows.filter((row) => row.status === "missing").length,
    unsupported: rows.filter((row) => row.status === "unsupported").length,
    incomplete: rows.filter((row) => row.status === "incomplete").length,
  };
  if (
    summary.totalFbaSkuCount !== rows.length ||
    summary.configured !== actual.configured ||
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
  if (
    (presence === "present" && !businessPrice) ||
    (presence === "absent" && businessPrice !== null) ||
    (standardPrice && businessPrice &&
      standardPrice.currencyCode !== businessPrice.currencyCode)
  ) {
    throw new Error("B2B 價格與 offer 證據不一致。");
  }
  const rawCapability = record(source.businessPricingCapability);
  if (
    typeof rawCapability.supported !== "boolean" ||
    typeof rawCapability.editable !== "boolean" ||
    (rawCapability.reason !== null && typeof rawCapability.reason !== "string") ||
    (rawCapability.schemaChecksum !== null &&
      typeof rawCapability.schemaChecksum !== "string") ||
    (rawCapability.editable && !rawCapability.supported)
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
    businessOfferGuardHash: exactHash(
      source.businessOfferGuardHash,
      "offer guard",
    ),
    businessPricingCapability: Object.freeze({
      supported: rawCapability.supported,
      editable: rawCapability.editable,
      reason: capabilityReason,
      schemaChecksum,
    }),
    fetchedAt,
    notice: optionalExactText(source.notice, "說明", 4_000),
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
    businessOfferGuardHash: exactHash(
      source.businessOfferGuardHash,
      "預檢 offer guard",
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
  const body = Object.freeze({
    marketplaceId: input.listing.marketplaceId,
    sellerSku: input.listing.sellerSku,
    expectedStandardPrice: input.listing.standardPrice.amount,
    expectedBusinessPrice: input.listing.businessPrice?.amount ?? null,
    newBusinessPrice: input.newBusinessPrice,
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
    validation.schemaChecksum !==
      input.listing.businessPricingCapability.schemaChecksum ||
    !sameMoney(validation.standardPrice, input.listing.standardPrice) ||
    !sameMoney(validation.previousBusinessPrice, input.listing.businessPrice) ||
    validation.requestedBusinessPrice.amount !== body.newBusinessPrice ||
    validation.requestedBusinessPrice.currencyCode !== currency
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
    source.businessOfferGuardHash !== validation.businessOfferGuardHash ||
    source.schemaChecksum !== validation.schemaChecksum ||
    !sameMoney(standardPrice, validation.standardPrice) ||
    !sameMoney(previousBusinessPrice, validation.previousBusinessPrice) ||
    requestedBusinessPrice.amount !== submitted.body.newBusinessPrice ||
    requestedBusinessPrice.currencyCode !== standardPrice.currencyCode
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
    acceptedAt,
    issues: parseIssues(source.issues),
    notice: displayText(source.notice, "更新說明", 4_000),
  });
}
