import { createHash } from "node:crypto";
import type { ApiRequest, ApiResponse } from "../shared/contracts";
import {
  marketplaceById,
  type MarketplaceId,
} from "../shared/marketplaces";
import type {
  ListingContentGateway,
  ListingContentGatewayRead,
  ListingContentIdentity,
  ListingContentPatchDescriptor,
} from "./amazon/listing-content-gateway";
import type {
  ListingContentField,
  ListingContentFieldCapability,
  ListingContentSnapshot,
  ListingContentUpdateResult,
  ListingContentValidationResult,
  ListingContentValues,
  UpdateListingContentInput,
} from "./amazon/listing-content-types";
import type { ListingWriteExecutionFence } from
  "./amazon/listing-write-execution-fence";
import {
  normalizeListingIssues,
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
  parseMarketplace,
  parseSellerSku,
} from "./route-input";
import { invalid, json, routeError } from "./route-response";
import {
  MainWriteGateError,
  type MainWriteGatePort,
  type MainWriteGateSession,
  type WriteBinding,
} from "./write-gate";

export type ListingContentMutationCommand = Readonly<{
  operation: "read" | "preview" | "commit";
  request: ApiRequest;
}>;

export type ListingContentPrecommitEvidence = Readonly<{
  version: 1;
  marketplaceId: MarketplaceId;
  sellerSku: string;
  asin: string;
  productType: string;
  languageTag: string;
  fulfillment: "FBA";
  expectedOldHash: string;
  rawContentGuardHash: string;
  capabilityGuardHash: string;
  fbaEvidenceHash: string;
  schemaChecksum: string;
  canonicalPatchHash: string;
  validationIssuesHash: string;
  changedFields: readonly ListingContentField[];
}>;

export type ListingContentPreparedPreview =
  ListingContentValidationResult & Readonly<{
    evidence: ListingContentPrecommitEvidence;
    proposalFingerprint: string;
  }>;

export interface ListingContentMutationsPort {
  handle(command: ListingContentMutationCommand): Promise<ApiResponse>;
  readOne(
    identity: ListingContentIdentity,
    context: SpExecutionContext,
  ): Promise<ListingContentSnapshot>;
  previewOne(
    input: UpdateListingContentInput,
  ): Promise<ListingContentPreparedPreview>;
  attemptOne(
    input: UpdateListingContentInput,
    expectedEvidence: ListingContentPrecommitEvidence,
    session: MainWriteGateSession,
    intentId: string,
  ): Promise<ListingContentUpdateResult>;
}

type ListingContentRouteInput = UpdateListingContentInput & Readonly<{
  idempotencyKey: string;
}>;

type VerifiedContentChange = Readonly<{
  previous: ListingContentValues;
  requested: ListingContentValues;
  changedFields: readonly ListingContentField[];
}>;

type PreparedContentMutation = Readonly<{
  observation: ListingContentGatewayRead;
  patch: ListingContentPatchDescriptor;
  verified: VerifiedContentChange;
  issues: readonly ListingIssue[];
  evidence: ListingContentPrecommitEvidence;
  proposalFingerprint: string;
}>;

type ListingContentWriteEvidence = ListingContentPrecommitEvidence & Readonly<{
  previous: ListingContentValues;
  requested: ListingContentValues;
  proposalFingerprint: string;
}>;

type DurableListingContentResult = ListingContentUpdateResult & Readonly<{
  _writeEvidence: ListingContentWriteEvidence;
}>;

type DispatchedListingContentResult =
  Omit<DurableListingContentResult, "status"> & Readonly<{
    status: "DISPATCHED";
  }>;

type ListingContentDurableResult =
  | DurableListingContentResult
  | DispatchedListingContentResult;

interface ListingContentMutationOperations {
  read(identity: ListingContentIdentity): Promise<ListingContentGatewayRead>;
  preview(
    input: UpdateListingContentInput,
  ): Promise<ListingContentPreparedPreview>;
  commitOne(
    input: UpdateListingContentInput,
    control: Readonly<{
      expectedEvidence?: ListingContentPrecommitEvidence;
      fence: ListingWriteExecutionFence;
      recordDurableEvidence(
        result: ListingContentDurableResult,
      ): Promise<void>;
    }>,
  ): Promise<DurableListingContentResult>;
}

const CONTENT_FIELDS = [
  "title",
  "itemHighlight",
  "bulletPoints",
  "productDescription",
  "ingredients",
] as const satisfies readonly ListingContentField[];

const PRECOMMIT_EVIDENCE_KEYS = [
  "asin",
  "canonicalPatchHash",
  "capabilityGuardHash",
  "changedFields",
  "expectedOldHash",
  "fbaEvidenceHash",
  "fulfillment",
  "languageTag",
  "marketplaceId",
  "productType",
  "rawContentGuardHash",
  "schemaChecksum",
  "sellerSku",
  "validationIssuesHash",
  "version",
] as const;

const WRITE_EVIDENCE_KEYS = [
  ...PRECOMMIT_EVIDENCE_KEYS,
  "previous",
  "proposalFingerprint",
  "requested",
] as const;

const DURABLE_RESULT_KEYS = [
  "_writeEvidence",
  "acceptedAt",
  "changedFields",
  "issues",
  "marketplaceId",
  "mode",
  "notice",
  "previous",
  "requestId",
  "requested",
  "sellerSku",
  "status",
  "submissionId",
] as const;

const NORMALIZED_ISSUE_KEYS = [
  "attributeNames",
  "categories",
  "code",
  "marketplaceIds",
  "message",
  "severity",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function validSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function validIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value;
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

function parseText(value: unknown, maximum: number): string | null {
  if (typeof value !== "string" || value.length > maximum) return null;
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
    ? null
    : value;
}

function parseBullets(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 5) return null;
  const result: string[] = [];
  for (const item of value) {
    const parsed = parseText(item, 5_000);
    if (parsed === null) return null;
    result.push(parsed);
  }
  return result;
}

function validIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9-]{8,80}$/u.test(value);
}

function normalizeContentText(value: string): string {
  return value.replace(/\r\n?/gu, "\n").trim();
}

function normalizeContentValues(
  values: ListingContentValues,
): ListingContentValues {
  return {
    title: normalizeContentText(values.title),
    itemHighlight: normalizeContentText(values.itemHighlight),
    bulletPoints: values.bulletPoints
      .map(normalizeContentText)
      .filter(Boolean)
      .slice(0, 5),
    productDescription: normalizeContentText(values.productDescription),
    ingredients: normalizeContentText(values.ingredients),
  };
}

function sameTextArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function sameContentValues(
  left: ListingContentValues,
  right: ListingContentValues,
): boolean {
  return left.title === right.title &&
    left.itemHighlight === right.itemHighlight &&
    sameTextArray(left.bulletPoints, right.bulletPoints) &&
    left.productDescription === right.productDescription &&
    left.ingredients === right.ingredients;
}

function changedContentFields(
  previous: ListingContentValues,
  requested: ListingContentValues,
): ListingContentField[] {
  const changed: ListingContentField[] = [];
  if (previous.title !== requested.title) changed.push("title");
  if (previous.itemHighlight !== requested.itemHighlight) {
    changed.push("itemHighlight");
  }
  if (!sameTextArray(previous.bulletPoints, requested.bulletPoints)) {
    changed.push("bulletPoints");
  }
  if (previous.productDescription !== requested.productDescription) {
    changed.push("productDescription");
  }
  if (previous.ingredients !== requested.ingredients) {
    changed.push("ingredients");
  }
  return changed;
}

function exactChangedFields(
  value: unknown,
  previous: ListingContentValues,
  requested: ListingContentValues,
): value is readonly ListingContentField[] {
  if (!Array.isArray(value) || !value.length ||
      value.some((field) => !CONTENT_FIELDS.includes(field))) return false;
  const expected = changedContentFields(previous, requested);
  return value.length === expected.length &&
    value.every((field, index) => field === expected[index]);
}

function validStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) =>
    typeof entry === "string" &&
    entry.length <= 512 &&
    entry === entry.trim() &&
    !/[\u0000-\u001f\u007f]/u.test(entry)
  );
}

function validNormalizedIssue(value: unknown): value is ListingIssue {
  return isRecord(value) &&
    hasExactKeys(value, NORMALIZED_ISSUE_KEYS) &&
    (value.code === null ||
      (typeof value.code === "string" && value.code.length <= 256)) &&
    typeof value.severity === "string" &&
    ["ERROR", "WARNING", "INFO"].includes(value.severity) &&
    safeNotice(value.message) &&
    validStringList(value.attributeNames) &&
    validStringList(value.categories) &&
    validStringList(value.marketplaceIds);
}

function normalizedReceiptIssues(value: unknown): ListingIssue[] | null {
  if (!Array.isArray(value) || value.some((issue) => !isRecord(issue))) {
    return null;
  }
  const normalized = normalizeListingIssues(value);
  return normalized.every(validNormalizedIssue) ? normalized : null;
}

function exactDurableIssues(value: unknown): value is ListingIssue[] {
  return Array.isArray(value) && value.every(validNormalizedIssue);
}

function validCapabilityNumber(value: unknown): value is number | null {
  return value === null ||
    (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
}

function validCapability(value: unknown): value is ListingContentFieldCapability {
  return isRecord(value) &&
    typeof value.supported === "boolean" &&
    typeof value.editable === "boolean" &&
    typeof value.required === "boolean" &&
    validCapabilityNumber(value.minItems) &&
    validCapabilityNumber(value.maxItems) &&
    validCapabilityNumber(value.minLength) &&
    validCapabilityNumber(value.maxLength) &&
    validCapabilityNumber(value.maxUtf8Bytes) &&
    validStringList(value.languageTags) &&
    (value.reason === null ||
      (typeof value.reason === "string" && value.reason.length <= 2_000));
}

function contentValuesFromSnapshot(
  snapshot: ListingContentSnapshot,
): ListingContentValues {
  return normalizeContentValues({
    title: snapshot.title,
    itemHighlight: snapshot.itemHighlight,
    bulletPoints: snapshot.bulletPoints,
    productDescription: snapshot.productDescription,
    ingredients: snapshot.ingredients,
  });
}

function assertCanonicalObservation(
  gateway: ListingContentGateway,
  observation: ListingContentGatewayRead,
  identity: ListingContentIdentity,
): void {
  const snapshot = observation.snapshot;
  const capabilities = snapshot.capabilities;
  if (
    snapshot.mode !== gateway.mode(identity.marketplaceId) ||
    snapshot.marketplaceId !== identity.marketplaceId ||
    snapshot.sellerSku !== identity.sellerSku ||
    observation.fulfillment !== "FBA" ||
    typeof snapshot.asin !== "string" ||
    !/^[A-Z0-9]{10}$/u.test(snapshot.asin) ||
    !snapshot.productType ||
    snapshot.productType !== snapshot.productType.trim() ||
    snapshot.productType.toUpperCase() === "PRODUCT" ||
    !snapshot.languageTag ||
    snapshot.languageTag !== snapshot.languageTag.trim() ||
    !validSha256(observation.rawContentGuardHash) ||
    !validSha256(observation.capabilityGuardHash) ||
    !validSha256(observation.fbaEvidenceHash) ||
    !isRecord(snapshot.attributePresence) ||
    CONTENT_FIELDS.some((field) =>
      typeof snapshot.attributePresence[field] !== "boolean"
    ) ||
    !isRecord(capabilities) ||
    CONTENT_FIELDS.some((field) => !validCapability(capabilities[field])) ||
    !(capabilities.schemaChecksum === null ||
      (typeof capabilities.schemaChecksum === "string" &&
        capabilities.schemaChecksum.length > 0 &&
        capabilities.schemaChecksum === capabilities.schemaChecksum.trim())) ||
    typeof snapshot.title !== "string" ||
    typeof snapshot.itemHighlight !== "string" ||
    !Array.isArray(snapshot.bulletPoints) ||
    snapshot.bulletPoints.some((value) => typeof value !== "string") ||
    typeof snapshot.productDescription !== "string" ||
    typeof snapshot.ingredients !== "string" ||
    normalizedReceiptIssues(snapshot.issues) === null
  ) {
    throw new SpApiError(
      "Amazon 商品內容回應的模式、站點、SKU、ASIN、商品類型、FBA、欄位能力或證據不一致，已停止使用。",
      { status: 409, code: "LISTING_IDENTITY_MISMATCH" },
    );
  }
}

function verifyContentLength(
  label: string,
  value: string,
  capability: ListingContentFieldCapability,
): void {
  if (capability.minLength !== null && value.length < capability.minLength) {
    throw new SpApiError(`${label}至少需要 ${capability.minLength} 個字元。`, {
      status: 422,
      code: "CONTENT_LIMIT_EXCEEDED",
    });
  }
  if (capability.maxLength !== null && value.length > capability.maxLength) {
    throw new SpApiError(`${label}最多可輸入 ${capability.maxLength} 個字元。`, {
      status: 422,
      code: "CONTENT_LIMIT_EXCEEDED",
    });
  }
  if (
    capability.maxUtf8Bytes !== null &&
    new TextEncoder().encode(value).byteLength > capability.maxUtf8Bytes
  ) {
    throw new SpApiError(
      `${label}超過 Amazon 允許的 ${capability.maxUtf8Bytes} UTF-8 bytes。`,
      { status: 422, code: "CONTENT_LIMIT_EXCEEDED" },
    );
  }
}

function assertContentEditable(
  label: string,
  capability: ListingContentFieldCapability,
  languageTag: string,
): void {
  if (!capability.supported || !capability.editable) {
    throw new SpApiError(
      capability.reason || `${label}不支援由 API 修改。`,
      { status: 422, code: "CONTENT_FIELD_READ_ONLY" },
    );
  }
  if (
    capability.languageTags.length > 0 &&
    !capability.languageTags.includes(languageTag)
  ) {
    throw new SpApiError(
      `${label}的 seller-specific PTD 未開放目前語系。`,
      { status: 422, code: "CONTENT_FIELD_READ_ONLY" },
    );
  }
}

function verifyContentChange(
  listing: ListingContentSnapshot,
  input: UpdateListingContentInput,
): VerifiedContentChange {
  const previous = contentValuesFromSnapshot(listing);
  const expected = normalizeContentValues({
    title: input.expectedTitle,
    itemHighlight: input.expectedItemHighlight,
    bulletPoints: input.expectedBulletPoints,
    productDescription: input.expectedProductDescription,
    ingredients: input.expectedIngredients,
  });
  const requested = normalizeContentValues(input);
  if (!sameContentValues(previous, expected)) {
    throw new SpApiError(
      "商品內容已在查詢後發生變動。請重新查詢 SKU，再確認一次。",
      { status: 409, code: "CONTENT_CHANGED" },
    );
  }
  const changedFields = changedContentFields(previous, requested);
  if (!changedFields.length) {
    throw new SpApiError(
      "商品名稱、產品亮點、產品要點、產品敘述與成分都沒有變更。",
      { status: 400, code: "CONTENT_UNCHANGED" },
    );
  }
  if (changedFields.includes("title")) {
    const capability = listing.capabilities.title;
    assertContentEditable("商品標題", capability, listing.languageTag);
    if (!requested.title) {
      throw new SpApiError("商品標題不可留白。", {
        status: 422,
        code: "CONTENT_REQUIRED",
      });
    }
    verifyContentLength("商品標題", requested.title, capability);
  }
  if (changedFields.includes("itemHighlight")) {
    const capability = listing.capabilities.itemHighlight;
    assertContentEditable("產品亮點", capability, listing.languageTag);
    if (!requested.itemHighlight) {
      throw new SpApiError("產品亮點不可直接清空；請輸入更新後內容。", {
        status: 422,
        code: "CONTENT_REQUIRED",
      });
    }
    verifyContentLength("產品亮點", requested.itemHighlight, capability);
  }
  if (changedFields.includes("bulletPoints")) {
    const capability = listing.capabilities.bulletPoints;
    assertContentEditable("五大賣點", capability, listing.languageTag);
    const minimum = Math.max(1, capability.minItems ?? 1);
    const maximum = Math.min(5, capability.maxItems ?? 5);
    if (
      requested.bulletPoints.length < minimum ||
      requested.bulletPoints.length > maximum
    ) {
      throw new SpApiError(
        `此商品類型需要 ${minimum} 到 ${maximum} 個賣點。`,
        { status: 422, code: "CONTENT_LIMIT_EXCEEDED" },
      );
    }
    requested.bulletPoints.forEach((value, index) =>
      verifyContentLength(`賣點 ${index + 1}`, value, capability));
  }
  if (changedFields.includes("productDescription")) {
    const capability = listing.capabilities.productDescription;
    assertContentEditable("產品敘述", capability, listing.languageTag);
    if (!requested.productDescription) {
      throw new SpApiError("產品敘述不可直接清空；請輸入更新後內容。", {
        status: 422,
        code: "CONTENT_REQUIRED",
      });
    }
    verifyContentLength("產品敘述", requested.productDescription, capability);
  }
  if (changedFields.includes("ingredients")) {
    const capability = listing.capabilities.ingredients;
    assertContentEditable("成分", capability, listing.languageTag);
    if (!requested.ingredients) {
      throw new SpApiError(
        "為避免誤刪法規相關資料，成分不可直接清空；請輸入更新後內容。",
        { status: 422, code: "CONTENT_REQUIRED" },
      );
    }
    verifyContentLength("成分", requested.ingredients, capability);
  }
  return { previous, requested, changedFields };
}

function sortedIssues(issues: readonly ListingIssue[]): ListingIssue[] {
  return issues
    .map((issue) => ({
      ...issue,
      attributeNames: [...issue.attributeNames].sort(),
      categories: [...(issue.categories ?? [])].sort(),
      marketplaceIds: [...(issue.marketplaceIds ?? [])].sort(),
    }))
    .sort((left, right) =>
      JSON.stringify(canonicalJsonValue(left)).localeCompare(
        JSON.stringify(canonicalJsonValue(right)),
      ));
}

function precommitEvidence(
  observation: ListingContentGatewayRead,
  patch: ListingContentPatchDescriptor,
  issues: readonly ListingIssue[],
): ListingContentPrecommitEvidence {
  return {
    version: 1,
    marketplaceId: patch.marketplaceId,
    sellerSku: patch.sellerSku,
    asin: patch.asin,
    productType: patch.productType,
    languageTag: patch.languageTag,
    fulfillment: "FBA",
    expectedOldHash: patch.expectedOldHash,
    rawContentGuardHash: observation.rawContentGuardHash,
    capabilityGuardHash: observation.capabilityGuardHash,
    fbaEvidenceHash: observation.fbaEvidenceHash,
    schemaChecksum: patch.schemaChecksum,
    canonicalPatchHash: patch.expectedCanonicalPatchHash!,
    validationIssuesHash: canonicalSha256(sortedIssues(issues)),
    changedFields: [...patch.changedFields],
  };
}

function fingerprintParts(
  previous: ListingContentValues,
  requested: ListingContentValues,
  evidence: ListingContentPrecommitEvidence,
): unknown {
  return [
    evidence.marketplaceId,
    evidence.sellerSku,
    previous.title,
    previous.itemHighlight,
    previous.bulletPoints,
    previous.productDescription,
    previous.ingredients,
    requested.title,
    requested.itemHighlight,
    requested.bulletPoints,
    requested.productDescription,
    requested.ingredients,
    evidence.changedFields,
    evidence.asin,
    evidence.productType,
    evidence.languageTag,
    evidence.fulfillment,
    evidence.expectedOldHash,
    evidence.rawContentGuardHash,
    evidence.capabilityGuardHash,
    evidence.fbaEvidenceHash,
    evidence.schemaChecksum,
    evidence.canonicalPatchHash,
    evidence.validationIssuesHash,
  ];
}

function proposalFingerprint(
  previous: ListingContentValues,
  requested: ListingContentValues,
  evidence: ListingContentPrecommitEvidence,
): string {
  return canonicalSha256(fingerprintParts(previous, requested, evidence));
}

function validPrecommitEvidence(
  value: unknown,
): value is ListingContentPrecommitEvidence {
  if (!isRecord(value) || !hasExactKeys(value, PRECOMMIT_EVIDENCE_KEYS)) {
    return false;
  }
  return value.version === 1 &&
    typeof value.marketplaceId === "string" &&
    Boolean(marketplaceById(value.marketplaceId)) &&
    typeof value.sellerSku === "string" &&
    parseSellerSku(value.sellerSku) === value.sellerSku &&
    typeof value.asin === "string" &&
    /^[A-Z0-9]{10}$/u.test(value.asin) &&
    typeof value.productType === "string" &&
    value.productType.length > 0 &&
    value.productType === value.productType.trim() &&
    value.productType.toUpperCase() !== "PRODUCT" &&
    typeof value.languageTag === "string" &&
    value.languageTag.length > 0 &&
    value.languageTag === value.languageTag.trim() &&
    value.fulfillment === "FBA" &&
    validSha256(value.expectedOldHash) &&
    validSha256(value.rawContentGuardHash) &&
    validSha256(value.capabilityGuardHash) &&
    validSha256(value.fbaEvidenceHash) &&
    typeof value.schemaChecksum === "string" &&
    value.schemaChecksum.length > 0 &&
    value.schemaChecksum === value.schemaChecksum.trim() &&
    validSha256(value.canonicalPatchHash) &&
    validSha256(value.validationIssuesHash) &&
    Array.isArray(value.changedFields) &&
    value.changedFields.length > 0 &&
    value.changedFields.every((field) => CONTENT_FIELDS.includes(field));
}

function assertPrecommitEvidence(
  actual: ListingContentPrecommitEvidence,
  expected: ListingContentPrecommitEvidence,
): void {
  if (!validPrecommitEvidence(expected) ||
      canonicalSha256(actual) !== canonicalSha256(expected)) {
    throw new SpApiError(
      "Amazon 商品內容預檢後的身分、FBA、原文、欄位能力、PTD、patch 或警告證據已改變，請重新預檢。",
      { status: 409, code: "PREVIEW_CHANGED" },
    );
  }
}

async function prepareContentMutation(
  gateway: ListingContentGateway,
  input: UpdateListingContentInput,
  expectedEvidence?: ListingContentPrecommitEvidence,
): Promise<PreparedContentMutation> {
  const observation = await gateway.read(input, "mutation");
  assertCanonicalObservation(gateway, observation, input);
  const snapshot = observation.snapshot;
  if (!snapshot.capabilities.schemaChecksum) {
    throw new SpApiError(
      "Amazon seller-specific PTD 未提供可核對的商品內容 schema checksum，所有寫入已停用。",
      { status: 422, code: "CONTENT_FIELD_READ_ONLY" },
    );
  }
  const verified = verifyContentChange(snapshot, input);
  const previewPatch: ListingContentPatchDescriptor = {
    marketplaceId: input.marketplaceId,
    sellerSku: input.sellerSku,
    asin: snapshot.asin!,
    productType: snapshot.productType,
    languageTag: snapshot.languageTag,
    schemaChecksum: snapshot.capabilities.schemaChecksum,
    expectedOldHash: canonicalSha256(verified.previous),
    expectedCanonicalPatchHash: null,
    previous: structuredClone(verified.previous),
    requested: structuredClone(verified.requested),
    changedFields: [...verified.changedFields],
    sourceEvidence: observation.sourceEvidence,
    ptdEvidence: observation.ptdEvidence,
  };
  const receipt = await gateway.validationPreview(previewPatch);
  const issues = normalizedReceiptIssues(receipt.issues);
  if (!issues || !validSha256(receipt.canonicalPatchHash)) {
    throw new SpApiError(
      "Amazon 商品內容預檢的 patch 或 issues 證據格式無法辨識，尚未寫入。",
      {
        status: 502,
        code: "VALIDATION_STATUS_UNKNOWN",
        requestId: receipt.requestId,
        operation: "patchListingsItemPreview",
      },
    );
  }
  if (
    receipt.status === "INVALID" ||
    issues.some((issue) => issue.severity === "ERROR")
  ) {
    throw new SpApiError(
      issues.find((issue) => issue.severity === "ERROR")?.message ||
        "Amazon 商品內容預檢未通過，尚未寫入任何變更。",
      {
        status: 422,
        code: "VALIDATION_FAILED",
        requestId: receipt.requestId,
        issues,
        operation: "patchListingsItemPreview",
      },
    );
  }
  if (receipt.status !== "VALID") {
    throw new SpApiError(
      "Amazon 預檢沒有回傳明確的 VALID 狀態，已停止送出。",
      {
        status: 502,
        code: "VALIDATION_STATUS_UNKNOWN",
        requestId: receipt.requestId,
        issues,
        operation: "patchListingsItemPreview",
      },
    );
  }
  const patch: ListingContentPatchDescriptor = {
    ...previewPatch,
    expectedCanonicalPatchHash: receipt.canonicalPatchHash,
  };
  const evidence = precommitEvidence(observation, patch, issues);
  if (expectedEvidence) assertPrecommitEvidence(evidence, expectedEvidence);
  return {
    observation,
    patch,
    verified,
    issues,
    evidence,
    proposalFingerprint: proposalFingerprint(
      verified.previous,
      verified.requested,
      evidence,
    ),
  };
}

function writeEvidence(
  prepared: PreparedContentMutation,
): ListingContentWriteEvidence {
  return {
    ...structuredClone(prepared.evidence),
    previous: structuredClone(prepared.verified.previous),
    requested: structuredClone(prepared.verified.requested),
    proposalFingerprint: prepared.proposalFingerprint,
  };
}

function durableResult(
  prepared: PreparedContentMutation,
  input: Readonly<{
    status: "ACCEPTED" | "SIMULATED" | "DISPATCHED";
    acceptedAt: string;
    submissionId: string | null;
    requestId: string | null;
    issues: readonly ListingIssue[];
    notice: string;
  }>,
): ListingContentDurableResult {
  return {
    mode: prepared.observation.snapshot.mode,
    status: input.status,
    marketplaceId: prepared.patch.marketplaceId,
    sellerSku: prepared.patch.sellerSku,
    previous: structuredClone(prepared.verified.previous),
    requested: structuredClone(prepared.verified.requested),
    changedFields: [...prepared.verified.changedFields],
    acceptedAt: input.acceptedAt,
    submissionId: input.submissionId,
    requestId: input.requestId,
    issues: normalizeListingIssues(input.issues),
    notice: input.notice,
    _writeEvidence: writeEvidence(prepared),
  };
}

function dispatchedResult(
  prepared: PreparedContentMutation,
): DispatchedListingContentResult {
  return durableResult(prepared, {
    status: "DISPATCHED",
    acceptedAt: new Date().toISOString(),
    submissionId: null,
    requestId: null,
    issues: [],
    notice:
      "Amazon 正式商品內容 PATCH 已進入送出邊界；等待 receipt 與 canonical readback。",
  }) as DispatchedListingContentResult;
}

async function prepareCommit(
  work: () => Promise<PreparedContentMutation>,
): Promise<PreparedContentMutation> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof SpApiPreCommitError) throw error;
    const cause = error instanceof SpApiError
      ? error
      : new SpApiError(
          "商品內容正式寫入前的重新讀取、PTD 或 Validation Preview 失敗。",
          { status: 500, code: "PRECOMMIT_FAILED" },
        );
    throw new SpApiPreCommitError(cause);
  }
}

function createListingContentMutationOperations(
  gateway: ListingContentGateway,
): ListingContentMutationOperations {
  return {
    read: async (identity) => {
      const observation = await gateway.read(identity, "read-only");
      assertCanonicalObservation(gateway, observation, identity);
      return observation;
    },
    preview: async (input) => {
      const prepared = await prepareContentMutation(gateway, input);
      const mode = prepared.observation.snapshot.mode;
      return {
        mode,
        status: mode === "demo" ? "SIMULATED" : "VALID",
        marketplaceId: input.marketplaceId,
        sellerSku: input.sellerSku,
        previous: structuredClone(prepared.verified.previous),
        requested: structuredClone(prepared.verified.requested),
        changedFields: [...prepared.verified.changedFields],
        validatedAt: new Date().toISOString(),
        issues: normalizeListingIssues(prepared.issues),
        notice: mode === "demo"
          ? "展示預檢已通過；最終按鈕只會模擬，不會寫入 Amazon。"
          : prepared.issues.length
            ? "Amazon 預檢通過，但有警告需要確認。"
            : "Amazon 預檢通過，尚未寫入商品內容。",
        evidence: structuredClone(prepared.evidence),
        proposalFingerprint: prepared.proposalFingerprint,
      };
    },
    commitOne: async (input, control) => {
      const prepared = await prepareCommit(() =>
        prepareContentMutation(gateway, input, control.expectedEvidence)
      );
      if (prepared.observation.snapshot.mode === "demo") {
        await gateway.replaceDemoContent(prepared.patch, control.fence);
        return durableResult(prepared, {
          status: "SIMULATED",
          acceptedAt: new Date().toISOString(),
          submissionId: null,
          requestId: null,
          issues: [],
          notice: "模擬商品內容更新完成；Amazon 真實內容沒有變更。",
        }) as DurableListingContentResult;
      }
      const receipt = await gateway.commitOnce(
        prepared.patch,
        control.fence,
        () => control.recordDurableEvidence(dispatchedResult(prepared)),
      );
      const issues = normalizedReceiptIssues(receipt.issues);
      if (!issues) {
        throw new SpApiError(
          "Amazon 已回傳商品內容接受狀態，但 issues 格式無法辨識。請重新查詢確認，勿盲目重送。",
          {
            status: 502,
            code: "UPDATE_STATUS_UNKNOWN",
            requestId: receipt.requestId,
            operation: "patchListingsItem",
          },
        );
      }
      if (receipt.status === "INVALID") {
        throw new SpApiError(
          issues.find((issue) => issue.severity === "ERROR")?.message ||
            "Amazon 未接受這次商品內容更新。",
          {
            status: 422,
            code: "UPDATE_REJECTED",
            requestId: receipt.requestId,
            issues,
            operation: "patchListingsItem",
          },
        );
      }
      if (
        receipt.status !== "ACCEPTED" ||
        !safeOptionalIdentifier(receipt.submissionId) ||
        receipt.submissionId === null ||
        !safeOptionalIdentifier(receipt.requestId) ||
        issues.some((issue) => issue.severity === "ERROR")
      ) {
        throw new SpApiError(
          "Amazon 商品內容正式回應的狀態、submissionId 或 issues 互相矛盾／無法辨識。請重新查詢確認，勿盲目重送。",
          {
            status: 502,
            code: "UPDATE_STATUS_UNKNOWN",
            requestId: safeOptionalIdentifier(receipt.requestId)
              ? receipt.requestId
              : null,
            issues,
            operation: "patchListingsItem",
          },
        );
      }
      return durableResult(prepared, {
        status: "ACCEPTED",
        acceptedAt: new Date().toISOString(),
        submissionId: receipt.submissionId,
        requestId: receipt.requestId,
        issues,
        notice:
          "Amazon 已接受商品內容更新；重新查詢看到新內容且沒有 ERROR 才代表完成。",
      }) as DurableListingContentResult;
    },
  };
}

function validContentText(value: unknown, maximum: number): value is string {
  return typeof value === "string" &&
    value.length <= maximum &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value) &&
    normalizeContentText(value) === value;
}

function validContentValues(value: unknown): value is ListingContentValues {
  return isRecord(value) &&
    hasExactKeys(value, CONTENT_FIELDS) &&
    validContentText(value.title, 2_000) &&
    validContentText(value.itemHighlight, 2_000) &&
    Array.isArray(value.bulletPoints) &&
    value.bulletPoints.length <= 5 &&
    value.bulletPoints.every((bullet) => validContentText(bullet, 5_000)) &&
    validContentText(value.productDescription, 50_000) &&
    validContentText(value.ingredients, 20_000);
}

function exactWriteEvidence(
  value: unknown,
): value is ListingContentWriteEvidence {
  if (!isRecord(value) || !hasExactKeys(value, WRITE_EVIDENCE_KEYS)) {
    return false;
  }
  const precommit = Object.fromEntries(
    PRECOMMIT_EVIDENCE_KEYS.map((key) => [key, value[key]]),
  );
  if (!validPrecommitEvidence(precommit) ||
      !validContentValues(value.previous) ||
      !validContentValues(value.requested) ||
      !exactChangedFields(
        precommit.changedFields,
        value.previous,
        value.requested,
      ) ||
      precommit.expectedOldHash !== canonicalSha256(value.previous) ||
      !validSha256(value.proposalFingerprint)) {
    return false;
  }
  return value.proposalFingerprint === proposalFingerprint(
    value.previous,
    value.requested,
    precommit,
  );
}

function changedFieldHasError(
  snapshot: ListingContentSnapshot,
  changedFields: readonly ListingContentField[],
): boolean {
  const attributes = new Set(
    changedFields.flatMap((field) => {
      if (field === "title") return ["item_name", "title"];
      if (field === "itemHighlight") {
        return ["title_differentiation", "itemHighlight"];
      }
      if (field === "bulletPoints") {
        return ["bullet_point", "bulletPoints"];
      }
      if (field === "productDescription") {
        return ["product_description", "productDescription"];
      }
      return ["ingredients"];
    }),
  );
  return snapshot.issues.some((issue) =>
    issue.severity === "ERROR" &&
    (issue.attributeNames.length === 0 ||
      issue.attributeNames.some((name) => attributes.has(name)))
  );
}

function canonicalChangedFieldsMatch(
  evidence: ListingContentWriteEvidence,
  snapshot: ListingContentSnapshot,
): boolean {
  for (const field of evidence.changedFields) {
    if (field === "title" &&
        (!snapshot.attributePresence.title ||
          normalizeContentText(snapshot.title) !== evidence.requested.title)) {
      return false;
    }
    if (field === "itemHighlight" &&
        (!snapshot.attributePresence.itemHighlight ||
          normalizeContentText(snapshot.itemHighlight) !==
            evidence.requested.itemHighlight)) {
      return false;
    }
    if (field === "bulletPoints") {
      const actual = snapshot.bulletPoints.map(normalizeContentText);
      if (!snapshot.attributePresence.bulletPoints ||
          !sameTextArray(actual, evidence.requested.bulletPoints)) {
        return false;
      }
    }
    if (field === "productDescription" &&
        (!snapshot.attributePresence.productDescription ||
          normalizeContentText(snapshot.productDescription) !==
            evidence.requested.productDescription)) {
      return false;
    }
    if (field === "ingredients" &&
        (!snapshot.attributePresence.ingredients ||
          normalizeContentText(snapshot.ingredients) !==
            evidence.requested.ingredients)) {
      return false;
    }
  }
  return true;
}

export function contentReadbackDecision(
  result: ListingContentUpdateResult,
  observation: ListingContentGatewayRead,
): "verified" | "pending" {
  const rawEvidence = (result as ListingContentUpdateResult & {
    _writeEvidence?: unknown;
  })._writeEvidence;
  if (!exactWriteEvidence(rawEvidence)) return "pending";
  const snapshot = observation.snapshot;
  return result.mode === "live" &&
      result.status === "ACCEPTED" &&
      observation.fulfillment === "FBA" &&
      snapshot.mode === "live" &&
      result.marketplaceId === rawEvidence.marketplaceId &&
      result.sellerSku === rawEvidence.sellerSku &&
      snapshot.marketplaceId === rawEvidence.marketplaceId &&
      snapshot.sellerSku === rawEvidence.sellerSku &&
      snapshot.asin === rawEvidence.asin &&
      snapshot.productType === rawEvidence.productType &&
      snapshot.languageTag === rawEvidence.languageTag &&
      snapshot.capabilities.schemaChecksum === rawEvidence.schemaChecksum &&
      observation.capabilityGuardHash === rawEvidence.capabilityGuardHash &&
      observation.fbaEvidenceHash === rawEvidence.fbaEvidenceHash &&
      !changedFieldHasError(snapshot, rawEvidence.changedFields) &&
      canonicalChangedFieldsMatch(rawEvidence, snapshot)
    ? "verified"
    : "pending";
}

function durableEnvelopeMatchesEvidence(
  response: Record<string, unknown>,
  evidence: ListingContentWriteEvidence,
): boolean {
  return response.marketplaceId === evidence.marketplaceId &&
    response.sellerSku === evidence.sellerSku &&
    validContentValues(response.previous) &&
    sameContentValues(response.previous, evidence.previous) &&
    validContentValues(response.requested) &&
    sameContentValues(response.requested, evidence.requested) &&
    exactChangedFields(
      response.changedFields,
      evidence.previous,
      evidence.requested,
    ) &&
    JSON.stringify(response.changedFields) ===
      JSON.stringify(evidence.changedFields);
}

function validDurableStatusMetadata(
  response: Record<string, unknown>,
): boolean {
  if (response.status === "DISPATCHED") {
    return response.submissionId === null &&
      response.requestId === null &&
      Array.isArray(response.issues) &&
      response.issues.length === 0;
  }
  return response.status === "ACCEPTED" &&
    typeof response.submissionId === "string" &&
    safeOptionalIdentifier(response.submissionId) &&
    safeOptionalIdentifier(response.requestId) &&
    exactDurableIssues(response.issues);
}

export function reconcileContentWrite(
  response: unknown,
  observation: ListingContentGatewayRead,
  now: () => Date = () => new Date(),
): unknown | null {
  if (!isRecord(response) ||
      !hasExactKeys(response, DURABLE_RESULT_KEYS) ||
      response.mode !== "live" ||
      (response.status !== "DISPATCHED" && response.status !== "ACCEPTED") ||
      !exactWriteEvidence(response._writeEvidence) ||
      !durableEnvelopeMatchesEvidence(response, response._writeEvidence) ||
      !validIsoTimestamp(response.acceptedAt) ||
      !safeNotice(response.notice) ||
      !validDurableStatusMetadata(response)) {
    return null;
  }
  const canonicalComparison = {
    ...response,
    status: "ACCEPTED",
  } as unknown as ListingContentUpdateResult;
  if (contentReadbackDecision(canonicalComparison, observation) !== "verified") {
    return null;
  }
  return {
    ...response,
    status: "ACCEPTED",
    notice:
      "Amazon 商品內容已由主程序唯讀回查確認；未重新送出 PATCH。",
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

function publicPreviewResult(
  value: ListingContentPreparedPreview,
): ListingContentValidationResult {
  const {
    evidence: _internalEvidence,
    proposalFingerprint: _internalFingerprint,
    ...publicValue
  } = value;
  return publicValue;
}

function publicUpdateResult<T>(value: T): T {
  if (!isRecord(value)) return value;
  const { _writeEvidence: _internalEvidence, ...publicValue } = value;
  return publicValue as T;
}

function writeError(error: unknown, fallback: string): ApiResponse {
  return error instanceof MainWriteGateError
    ? invalid(error.message, error.status, error.code)
    : routeError(error, fallback);
}

function marketplaceCode(marketplaceId: MarketplaceId): string {
  const code = marketplaceById(marketplaceId)?.code ?? "";
  return code === "UK" ? "GB" : code;
}

export class ListingContentMutations implements ListingContentMutationsPort {
  private readonly context: SpExecutionContextAdapter;
  private readonly writeGate: MainWriteGatePort;
  private readonly operations: ListingContentMutationOperations;

  constructor(input: Readonly<{
    context: SpExecutionContextAdapter;
    writeGate: MainWriteGatePort;
    gateway: ListingContentGateway;
  }>) {
    this.context = input.context;
    this.writeGate = input.writeGate;
    this.operations = createListingContentMutationOperations(input.gateway);
  }

  async handle(command: ListingContentMutationCommand): Promise<ApiResponse> {
    if (command.operation === "read") return this.readRoute(command.request);
    if (command.operation === "preview") {
      return this.previewRoute(command.request);
    }
    return this.commitRoute(command.request);
  }

  async readOne(
    identity: ListingContentIdentity,
    context: SpExecutionContext,
  ): Promise<ListingContentSnapshot> {
    if (context.marketplaceId !== identity.marketplaceId) {
      throw new SpApiError(
        "商品內容查詢的執行站點與要求不一致，已停止使用。",
        { status: 409, code: "LISTING_IDENTITY_MISMATCH" },
      );
    }
    const observation = await this.operations.read(identity);
    await this.context.assertCurrent(context);
    await this.writeGate.reconcile({
      context,
      marketplaceId: identity.marketplaceId,
      sellerSku: identity.sellerSku,
      operations: ["content"],
      snapshot: observation,
      project: (response, _operation, canonical) =>
        reconcileContentWrite(response, canonical),
    });
    return observation.snapshot;
  }

  async previewOne(
    input: UpdateListingContentInput,
  ): Promise<ListingContentPreparedPreview> {
    return this.operations.preview(input);
  }

  async attemptOne(
    input: UpdateListingContentInput,
    expectedEvidence: ListingContentPrecommitEvidence,
    session: MainWriteGateSession,
    intentId: string,
  ): Promise<ListingContentUpdateResult> {
    const result = await session.attempt<ListingContentDurableResult>({
      intentId,
      execute: (control) =>
        commitWithCanonicalReadback({
          commit: () => this.operations.commitOne(input, {
            expectedEvidence,
            fence: { assertCurrent: control.assertCurrent },
            recordDurableEvidence:
              control.recordDurableEvidence ?? control.recordAccepted,
          }),
          onAccepted: control.recordAccepted,
          assertCurrent: control.assertCurrent,
          read: () => this.operations.read({
            marketplaceId: input.marketplaceId,
            sellerSku: input.sellerSku,
          }),
          decide: contentReadbackDecision,
        }),
    });
    if (result.status === "DISPATCHED") {
      throw new SpApiError(
        "Amazon 商品內容寫入只留下已送出證據，無法證明正式結果；請重新查詢確認，勿盲目重送。",
        { status: 503, code: "UPDATE_STATUS_UNKNOWN" },
      );
    }
    return publicUpdateResult(result);
  }

  private async readRoute(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    const sellerSku = parseSellerSku(request.query.sku);
    if (!marketplaceId || !sellerSku) {
      return invalid("請選擇站點並輸入完整 SKU。");
    }
    try {
      const context = await this.context.capture(marketplaceId);
      const snapshot = await this.readOne(
        { marketplaceId, sellerSku },
        context,
      );
      return json(snapshot);
    } catch (error) {
      return routeError(error, "查詢商品內容時發生未預期的錯誤。");
    }
  }

  private routeInput(
    request: ApiRequest,
  ): ListingContentRouteInput | ApiResponse {
    const body = bodyRecord(request);
    if (!body) {
      return invalid(
        "商品內容請求必須使用 JSON。",
        415,
        "UNSUPPORTED_MEDIA_TYPE",
      );
    }
    const marketplaceId = parseMarketplace(body.marketplaceId);
    const sellerSku = parseSellerSku(body.sellerSku);
    const title = parseText(body.title, 2_000);
    const expectedTitle = parseText(body.expectedTitle, 2_000);
    const itemHighlight = parseText(body.itemHighlight, 2_000);
    const expectedItemHighlight = parseText(body.expectedItemHighlight, 2_000);
    const bulletPoints = parseBullets(body.bulletPoints);
    const expectedBulletPoints = parseBullets(body.expectedBulletPoints);
    const productDescription = parseText(body.productDescription, 50_000);
    const expectedProductDescription = parseText(
      body.expectedProductDescription,
      50_000,
    );
    const ingredients = parseText(body.ingredients, 20_000);
    const expectedIngredients = parseText(body.expectedIngredients, 20_000);
    if (
      !marketplaceId ||
      !sellerSku ||
      title === null ||
      expectedTitle === null ||
      itemHighlight === null ||
      expectedItemHighlight === null ||
      bulletPoints === null ||
      expectedBulletPoints === null ||
      productDescription === null ||
      expectedProductDescription === null ||
      ingredients === null ||
      expectedIngredients === null
    ) {
      return invalid(
        "請提供有效的站點、SKU、產品名稱、產品亮點、最多五個產品要點、產品敘述與成分。",
      );
    }
    return {
      marketplaceId,
      sellerSku,
      title,
      expectedTitle,
      itemHighlight,
      expectedItemHighlight,
      bulletPoints,
      expectedBulletPoints,
      productDescription,
      expectedProductDescription,
      ingredients,
      expectedIngredients,
      idempotencyKey: typeof body.idempotencyKey === "string"
        ? body.idempotencyKey
        : "",
    };
  }

  private binding(
    input: ListingContentRouteInput,
    prepared: ListingContentPreparedPreview,
    context: SpExecutionContext,
  ): WriteBinding {
    return {
      family: "content",
      previewKey: input.idempotencyKey,
      context,
      intents: [{
        intentId: "primary",
        operation: "content",
        marketplaceId: input.marketplaceId,
        sellerSku: input.sellerSku,
        idempotencyKey: input.idempotencyKey,
        proposalFingerprint: prepared.proposalFingerprint,
      }],
    };
  }

  private async previewRoute(request: ApiRequest): Promise<ApiResponse> {
    const input = this.routeInput(request);
    if ("status" in input) return input;
    try {
      const context = await this.context.capture(input.marketplaceId);
      const result = await this.previewOne(input);
      if (
        result.mode !== context.mode ||
        result.marketplaceId !== input.marketplaceId ||
        result.sellerSku !== input.sellerSku
      ) {
        throw new SpApiError(
          "Amazon 商品內容預檢結果不屬於這次要求的執行模式、站點或 Seller SKU，已停止使用。",
          { status: 409, code: "LISTING_IDENTITY_MISMATCH" },
        );
      }
      await this.context.assertCurrent(context);
      if (validIdempotencyKey(input.idempotencyKey)) {
        await this.writeGate.stagePreview(this.binding(input, result, context));
      }
      return json(publicPreviewResult(result));
    } catch (error) {
      return writeError(error, "商品內容預檢時發生未預期的錯誤。");
    }
  }

  private async commitRoute(request: ApiRequest): Promise<ApiResponse> {
    const input = this.routeInput(request);
    if ("status" in input) return input;
    if (!validIdempotencyKey(input.idempotencyKey)) {
      return invalid("這次預檢已失效，請重新預檢。");
    }
    let context: SpExecutionContext;
    let prepared: ListingContentPreparedPreview;
    try {
      context = await this.context.capture(input.marketplaceId);
      prepared = await this.previewOne(input);
      await this.context.assertCurrent(context);
    } catch (error) {
      return routeError(
        error,
        "正式確認前重新執行 Amazon 商品內容預檢時發生未預期的錯誤。",
      );
    }
    const labels: Record<ListingContentField, string> = {
      title: "產品名稱",
      itemHighlight: "產品亮點",
      bulletPoints: "產品要點",
      productDescription: "產品敘述",
      ingredients: "成分",
    };
    const changedFields = prepared.changedFields
      .map((field) => labels[field])
      .join("、");
    try {
      const result = await this.writeGate.execute({
        binding: this.binding(input, prepared, context),
        approvalReason: (verificationCode) =>
          `確認文案｜${marketplaceCode(input.marketplaceId)} ${input.sellerSku}｜${changedFields}｜驗證碼 ${verificationCode}`,
        run: (session) => this.attemptOne(
          input,
          prepared.evidence,
          session,
          "primary",
        ),
      });
      return json(publicUpdateResult(result));
    } catch (error) {
      return writeError(error, "送出商品內容時發生未預期的錯誤。");
    }
  }
}

export function createListingContentMutations(input: Readonly<{
  context: SpExecutionContextAdapter;
  writeGate: MainWriteGatePort;
  gateway: ListingContentGateway;
}>): ListingContentMutationsPort {
  return new ListingContentMutations(input);
}
