import { createHash } from "node:crypto";
import { abortableDelay as wait } from "./abort-utils";
import type { ApiRequest, ApiResponse } from "../shared/contracts";
import {
  marketplaceById,
  type MarketplaceId,
} from "../shared/marketplaces";
import type {
  VariationMoveInput,
  VariationMovePreparation,
  VariationMovePreview,
  VariationMoveResult,
} from "./amazon/variation-move-types";
import type {
  VariationMoveAttachDescriptor,
  VariationMoveCanonicalObservation,
  VariationMoveDescriptor,
  VariationMoveGateway,
  VariationMoveGatewayPreparation,
  VariationMoveObservation,
  VariationMoveSourceObservation,
  VariationMoveTargetObservation,
} from "./amazon/variation-move-gateway";
import type { ListingWriteExecutionFence } from
  "./amazon/listing-write-execution-fence";
import {
  publicSpApiIssueIdentifier,
  publicSpApiListingIssues,
  publicSpApiRequestId,
  SpApiError,
  SpApiPreCommitError,
  type ListingIssue,
} from "./amazon/sp-api-error";
import {
  variationDimensionSignature,
  variationFieldDescriptors,
  VariationUpdateValidationError,
  type VariationFieldDescriptor,
} from "./amazon/variation-update";
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

export type VariationMoveMutationCommand = Readonly<{
  operation: "prepare" | "preview" | "commit";
  request: ApiRequest;
}>;

export interface VariationMoveMutationsPort {
  handle(command: VariationMoveMutationCommand): Promise<ApiResponse>;
}

type VariationMoveWriteEvidence = Readonly<{
  version: 1;
  action: VariationMoveInput["action"];
  marketplaceId: MarketplaceId;
  sellerSku: string;
  asin: string;
  productType: string;
  fulfillment: "FBA";
  sourceParentSku: string | null;
  targetParentSku: string | null;
  targetAsin: string | null;
  variationTheme: string | null;
  dimensionNames: readonly string[];
  dimensionSignature: string | null;
  childSchemaChecksumHash: string | null;
}>;

const VARIATION_WRITE_EVIDENCE_KEYS = [
  "action",
  "asin",
  "childSchemaChecksumHash",
  "dimensionSignature",
  "dimensionNames",
  "fulfillment",
  "marketplaceId",
  "productType",
  "sellerSku",
  "sourceParentSku",
  "targetAsin",
  "targetParentSku",
  "variationTheme",
  "version",
] as const;

const VARIATION_PUBLIC_RESULT_KEYS = [
  "action",
  "completedAt",
  "issues",
  "marketplaceId",
  "mode",
  "notice",
  "requestId",
  "sellerSku",
  "sourceParentSku",
  "status",
  "submissionId",
  "targetParentSku",
  "variationTheme",
  "verified",
] as const;

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

type VariationMoveDurableResult = Omit<
  VariationMoveResult,
  "status" | "verified"
> &
  Readonly<{
    status: VariationMoveResult["status"] | "DISPATCHED";
    verified: boolean;
    _writeEvidence: VariationMoveWriteEvidence;
  }>;

type VariationMoveCommitControl = Readonly<{
  fence: ListingWriteExecutionFence;
  recordDurableEvidence(result: VariationMoveDurableResult): Promise<void>;
}>;

interface VariationMoveMutationOperations {
  readCanonical(input: Readonly<{
    marketplaceId: MarketplaceId;
    sellerSku: string;
  }>): Promise<VariationMoveCanonicalObservation>;
  prepare(input: Readonly<{
    marketplaceId: MarketplaceId;
    sellerSku: string;
    targetParentSku: string;
  }>): Promise<VariationMovePreparation>;
  preview(input: VariationMoveInput): Promise<VariationMovePreview>;
  commit(
    input: VariationMoveInput,
    control: VariationMoveCommitControl,
  ): Promise<VariationMoveDurableResult>;
}

type PreparedDescriptor = Readonly<{
  mode: "live" | "demo";
  descriptor: VariationMoveDescriptor;
  sourceParentSku: string | null;
  targetParentSku: string | null;
  variationTheme: string | null;
  dimensionSignature: string | null;
  childSchemaChecksumHash: string | null;
}>;

type PreparedAttachContext = Readonly<{
  mode: "live" | "demo";
  source: VariationMoveSourceObservation & Readonly<{
    asin: string;
    productType: string;
  }>;
  target: VariationMoveTargetObservation & Readonly<{
    productType: string;
    variationTheme: string;
    childSchemaChecksum: string;
  }>;
  fields: VariationFieldDescriptor[];
  requestIds: string[];
}>;

function validIdempotencyKey(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9-]{8,80}$/u.test(value)
    ? value
    : null;
}

function parseVariationDimensionNames(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 6) {
    return null;
  }
  const names: string[] = [];
  for (const entry of value) {
    if (
      typeof entry !== "string" ||
      entry.trim() !== entry ||
      !/^[a-z][a-z0-9_]{0,79}$/u.test(entry) ||
      names.includes(entry)
    ) {
      return null;
    }
    names.push(entry);
  }
  return names;
}

function variationJsonSafe(value: unknown, depth = 0): boolean {
  if (depth > 8) return false;
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return typeof value !== "string" ||
      (value.length <= 5_000 &&
        !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) {
    return value.length <= 30 &&
      value.every((entry) => variationJsonSafe(entry, depth + 1));
  }
  if (!isPlainRecord(value) || Object.keys(value).length > 30) return false;
  return Object.entries(value).every(
    ([key, child]) =>
      /^[a-zA-Z][a-zA-Z0-9_]{0,79}$/u.test(key) &&
      !["__proto__", "constructor", "prototype"].includes(key) &&
      variationJsonSafe(child, depth + 1),
  );
}

function parseVariationDimensionValues(
  value: unknown,
  dimensionNames: readonly string[],
): Record<string, unknown> | null {
  if (!isPlainRecord(value)) return null;
  const keys = Object.keys(value).sort();
  const expected = [...dimensionNames].sort();
  if (
    keys.length !== expected.length ||
    !keys.every((key, index) => key === expected[index]) ||
    !variationJsonSafe(value)
  ) {
    return null;
  }
  return JSON.stringify(value).length <= 64_000 ? structuredClone(value) : null;
}

function proposalFingerprint(input: VariationMoveInput): string {
  return createHash("sha256").update(JSON.stringify([
    input.action,
    input.marketplaceId,
    input.sellerSku,
    input.expectedSourceParentSku,
    input.targetParentSku,
    input.variationTheme,
    [...input.dimensionNames].sort(),
    input.dimensionValues,
  ])).digest("hex");
}

function marketplaceCode(marketplaceId: MarketplaceId): string {
  const code = marketplaceById(marketplaceId)?.code ?? "";
  return code === "UK" ? "GB" : code;
}

function exactAsin(value: string | null): value is string {
  return typeof value === "string" && /^[A-Z0-9]{10}$/u.test(value);
}

function exactProductType(value: string | null): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    value === value.trim() &&
    value.toUpperCase() !== "PRODUCT" &&
    /^[A-Z0-9_]+$/u.test(value);
}

function exactSchemaChecksum(value: string | null): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/u.test(value);
}

function exactDimensionNames(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const normalize = (values: readonly string[]) =>
    [...new Set(values.map((value) => value.trim()))]
      .filter(Boolean)
      .sort();
  const a = normalize(left);
  const b = normalize(right);
  return a.length === b.length &&
    a.every((value, index) => value === b[index]);
}

function publicIssues(value: unknown): ListingIssue[] {
  return publicSpApiListingIssues(value).map((issue) => ({
    code: issue.code,
    severity: issue.severity,
    message: issue.message,
    attributeNames: [...issue.attributeNames],
    ...(issue.categories === undefined
      ? {}
      : { categories: [...issue.categories] }),
    ...(issue.marketplaceIds === undefined
      ? {}
      : { marketplaceIds: [...issue.marketplaceIds] }),
  }));
}

function publicRequestIds(values: readonly string[]): string[] {
  return [...new Set(
    values.map(publicSpApiRequestId).filter(
      (value): value is string => value !== null,
    ),
  )];
}

function throwVariationValidation(error: unknown): never {
  if (error instanceof VariationUpdateValidationError) {
    const conflictCodes = new Set([
      "VARIATION_RELATIONSHIP_CHANGED",
      "VARIATION_RELATIONSHIP_CONFLICT",
      "VARIATION_NOT_DETACHED",
      "VARIATION_DETACH_NOT_VERIFIED",
      "VARIATION_ATTACH_NOT_VERIFIED",
    ]);
    throw new SpApiError(error.message, {
      status: conflictCodes.has(error.code) ? 409 : 422,
      code: error.code,
    });
  }
  throw error;
}

function assertGatewayPreparation(
  gateway: VariationMoveGateway,
  prepared: VariationMoveGatewayPreparation,
  input: Readonly<{
    action: "detach" | "attach";
    marketplaceId: MarketplaceId;
    sellerSku: string;
  }>,
): void {
  const mode = gateway.mode(input.marketplaceId);
  if (
    prepared.action !== input.action ||
    prepared.mode !== mode ||
    prepared.source.marketplaceId !== input.marketplaceId ||
    prepared.source.sellerSku !== input.sellerSku
  ) {
    throw new SpApiError(
      "變體 adapter 回傳的操作、模式、站點或來源 SKU 與請求不一致，已停止使用。",
      { status: 409, code: "LISTING_IDENTITY_MISMATCH" },
    );
  }
}

function assertCanonicalSource(
  source: VariationMoveSourceObservation,
): asserts source is VariationMoveSourceObservation & Readonly<{
  asin: string;
  productType: string;
}> {
  if (!exactAsin(source.asin) || !exactProductType(source.productType)) {
    throw new SpApiError(
      "來源 SKU 的 Amazon ASIN 或 product type 無法精確核對，已停止變體操作。",
      { status: 409, code: "LISTING_IDENTITY_MISMATCH" },
    );
  }
  if (source.fulfillment !== "FBA") {
    throw new SpApiError(
      "來源 SKU 無法確認為 FBA；變體工具不會加入或修改 FBM 商品。",
      { status: 422, code: "FBA_ONLY" },
    );
  }
  if (source.role === "parent") {
    throw new SpApiError(
      "Parent 是不可售容器，不能移動成另一個 parent 的 child。",
      { status: 422, code: "VARIATION_PARENT_NOT_MOVABLE" },
    );
  }
  if (!source.sourceEvidence || typeof source.sourceEvidence !== "object") {
    throw new SpApiError(
      "來源 SKU 缺少封閉的 Amazon 讀取證據，已停止變體操作。",
      { status: 409, code: "LISTING_IDENTITY_MISMATCH" },
    );
  }
}

function assertSourceFamilyComplete(
  source: VariationMoveSourceObservation,
): void {
  if (!source.familyComplete) {
    throw new SpApiError(
      "來源 family 清單不完整，已停止變體操作。",
      { status: 409, code: "VARIATION_FAMILY_INCOMPLETE" },
    );
  }
}

function assertDetachSource(
  source: VariationMoveSourceObservation & Readonly<{
    asin: string;
    productType: string;
  }>,
  expectedSourceParentSku: string,
): void {
  if (
    source.role !== "child" ||
    source.parentSku !== expectedSourceParentSku ||
    source.relationshipType?.toLowerCase() !== "variation" ||
    !source.variationTheme
  ) {
    throw new SpApiError(
      "來源 child 的 parent 或 variation 關係已在查詢後變更，請重新讀取。",
      { status: 409, code: "VARIATION_RELATIONSHIP_CHANGED" },
    );
  }
}

function assertStandaloneSource(
  source: VariationMoveSourceObservation & Readonly<{
    asin: string;
    productType: string;
  }>,
): void {
  if (
    source.role !== "standalone" ||
    source.parentSku !== null ||
    source.relationshipType !== null ||
    source.variationTheme !== null ||
    !source.explicitStandalone
  ) {
    throw new SpApiError(
      "Amazon relationships 尚未同時證明來源 SKU 為 standalone 且變體關係欄位為空；已停止加入新 parent。",
      { status: 409, code: "VARIATION_NOT_DETACHED" },
    );
  }
}

function assertTarget(
  source: VariationMoveSourceObservation & Readonly<{ productType: string }>,
  target: VariationMoveTargetObservation,
  expectedTargetParentSku: string,
  mode: "live" | "demo",
): asserts target is VariationMoveTargetObservation & Readonly<{
  productType: string;
  variationTheme: string;
  childSchemaChecksum: string;
}> {
  if (
    target.marketplaceId !== source.marketplaceId ||
    target.sellerSku !== expectedTargetParentSku ||
    target.role !== "parent" ||
    (mode === "live" && !exactAsin(target.asin)) ||
    (mode === "demo" && target.asin !== null && !exactAsin(target.asin))
  ) {
    throw new SpApiError(
      "目標 SKU 不是可精確核對的 parent 容器。",
      { status: 422, code: "VARIATION_TARGET_NOT_PARENT" },
    );
  }
  if (
    !exactProductType(target.productType) ||
    target.productType !== source.productType
  ) {
    throw new SpApiError(
      "來源 SKU 與目標 parent 的 Amazon product type 無法確認完全一致。",
      { status: 422, code: "VARIATION_PRODUCT_TYPE_MISMATCH" },
    );
  }
  if (!target.familyComplete) {
    throw new SpApiError(
      "目標 family 清單不完整，已停止變體操作。",
      { status: 409, code: "VARIATION_FAMILY_INCOMPLETE" },
    );
  }
  if (
    !target.variationTheme ||
    target.variationTheme !== target.variationTheme.trim() ||
    !parseVariationDimensionNames([...target.dimensionNames])
  ) {
    throw new SpApiError(
      "目標 parent 缺少可核對的 variation theme 或必要維度。",
      { status: 422, code: "VARIATION_DIMENSIONS_UNKNOWN" },
    );
  }
  if (
    !exactSchemaChecksum(target.childSchemaChecksum) ||
    !target.targetEvidence ||
    typeof target.targetEvidence !== "object" ||
    !target.ptdEvidence ||
    typeof target.ptdEvidence !== "object"
  ) {
    throw new SpApiError(
      "Amazon CHILD PTD 缺少可核對的 schema 或 checksum，已停止變體操作。",
      { status: 502, code: "PRODUCT_TYPE_SCHEMA_UNAVAILABLE" },
    );
  }
  const actualSourceNames = Object.keys(target.sourceDimensionValues).sort();
  const expectedNames = [...target.dimensionNames].sort();
  if (
    actualSourceNames.length !== expectedNames.length ||
    !actualSourceNames.every((name, index) => name === expectedNames[index])
  ) {
    throw new SpApiError(
      "來源 SKU 的 allowlisted dimension 讀取證據不完整，已停止變體操作。",
      { status: 409, code: "VARIATION_TARGET_DIMENSIONS_INCOMPLETE" },
    );
  }
}

function fieldsForTarget(
  marketplaceId: MarketplaceId,
  target: VariationMoveTargetObservation,
): VariationFieldDescriptor[] {
  let fields: VariationFieldDescriptor[];
  try {
    fields = variationFieldDescriptors({
      productTypeDefinition: target.childSchema,
      dimensionNames: [...target.dimensionNames],
      attributes: target.sourceDimensionValues,
      marketplaceId,
    });
  } catch (error) {
    return throwVariationValidation(error);
  }
  const readOnlyField = fields.find((field) => !field.editable);
  if (readOnlyField) {
    throw new SpApiError(
      `Amazon CHILD PTD 將 ${readOnlyField.name} 標示為唯讀，不能安全改掛此 SKU。`,
      { status: 422, code: "VARIATION_FIELD_READ_ONLY" },
    );
  }
  return fields;
}

async function prepareAttachContext(
  gateway: VariationMoveGateway,
  input: Readonly<{
    marketplaceId: MarketplaceId;
    sellerSku: string;
    targetParentSku: string;
  }>,
  purpose: "preparation" | "mutation",
): Promise<PreparedAttachContext> {
  const prepared = await gateway.prepare({
    action: "attach",
    marketplaceId: input.marketplaceId,
    sellerSku: input.sellerSku,
    targetParentSku: input.targetParentSku,
    purpose,
  });
  assertGatewayPreparation(gateway, prepared, {
    action: "attach",
    marketplaceId: input.marketplaceId,
    sellerSku: input.sellerSku,
  });
  if (prepared.action !== "attach") {
    throw new SpApiError("變體 adapter 回傳了錯誤的準備階段。", {
      status: 500,
      code: "UPSTREAM_UNAVAILABLE",
    });
  }
  const source = prepared.source;
  const target = prepared.target;
  assertCanonicalSource(source);
  assertTarget(source, target, input.targetParentSku, prepared.mode);
  if (source.parentSku === target.sellerSku) {
    throw new SpApiError(
      "此 child 已屬於目標 parent，沒有可執行的變體改掛。",
      { status: 409, code: "VARIATION_UNCHANGED" },
    );
  }
  return {
    mode: prepared.mode,
    source,
    target,
    fields: fieldsForTarget(input.marketplaceId, target),
    requestIds: publicRequestIds(prepared.requestIds),
  };
}

function requestedDimensionSignature(
  input: Extract<VariationMoveInput, { action: "attach" }>,
): string {
  try {
    return variationDimensionSignature({
      dimensionNames: input.dimensionNames,
      dimensionValues: input.dimensionValues,
      marketplaceId: input.marketplaceId,
    });
  } catch (error) {
    return throwVariationValidation(error);
  }
}

function assertNoDuplicateTargetDimensions(
  input: Extract<VariationMoveInput, { action: "attach" }>,
  target: VariationMoveTargetObservation,
  requestedSignature: string,
): void {
  for (const child of target.children) {
    if (child.sellerSku === input.sellerSku) continue;
    let existingSignature: string;
    try {
      existingSignature = variationDimensionSignature({
        dimensionNames: input.dimensionNames,
        dimensionValues: { ...child.dimensionValues },
        marketplaceId: input.marketplaceId,
      });
    } catch {
      throw new SpApiError(
        `目標 family 的 ${child.sellerSku} 缺少可核對的必要維度，已停止避免重複 child。`,
        { status: 409, code: "VARIATION_TARGET_DIMENSIONS_INCOMPLETE" },
      );
    }
    if (existingSignature === requestedSignature) {
      throw new SpApiError(
        `目標 family 的 ${child.sellerSku} 已有相同變體維度值。`,
        { status: 409, code: "VARIATION_DUPLICATE_DIMENSIONS" },
      );
    }
  }
}

async function prepareDescriptor(
  gateway: VariationMoveGateway,
  input: VariationMoveInput,
): Promise<PreparedDescriptor> {
  if (input.action === "detach") {
    const prepared = await gateway.prepare({
      action: "detach",
      marketplaceId: input.marketplaceId,
      sellerSku: input.sellerSku,
      expectedSourceParentSku: input.expectedSourceParentSku,
    });
    assertGatewayPreparation(gateway, prepared, input);
    if (prepared.action !== "detach") {
      throw new SpApiError("變體 adapter 回傳了錯誤的解除階段。", {
        status: 500,
        code: "UPSTREAM_UNAVAILABLE",
      });
    }
    const source = prepared.source;
    assertCanonicalSource(source);
    assertDetachSource(source, input.expectedSourceParentSku);
    assertSourceFamilyComplete(source);
    return {
      mode: prepared.mode,
      descriptor: {
        action: "detach",
        marketplaceId: input.marketplaceId,
        sellerSku: input.sellerSku,
        asin: source.asin,
        productType: source.productType,
        sourceEvidence: source.sourceEvidence,
        expectedSourceParentSku: input.expectedSourceParentSku,
        targetParentSku: null,
        variationTheme: null,
        dimensionNames: [],
        dimensionValues: {},
      },
      sourceParentSku: input.expectedSourceParentSku,
      targetParentSku: null,
      variationTheme: null,
      dimensionSignature: null,
      childSchemaChecksumHash: null,
    };
  }

  const prepared = await prepareAttachContext(gateway, input, "mutation");
  assertStandaloneSource(prepared.source);
  assertSourceFamilyComplete(prepared.source);
  if (
    prepared.target.sellerSku !== input.targetParentSku ||
    prepared.target.variationTheme !== input.variationTheme ||
    !exactDimensionNames(prepared.target.dimensionNames, input.dimensionNames)
  ) {
    throw new SpApiError(
      "目標 family 的 parent、theme 或必要維度已在準備後變更。",
      { status: 409, code: "VARIATION_TARGET_CHANGED" },
    );
  }
  const dimensionSignature = requestedDimensionSignature(input);
  assertNoDuplicateTargetDimensions(input, prepared.target, dimensionSignature);
  const descriptor: VariationMoveAttachDescriptor = {
    action: "attach",
    marketplaceId: input.marketplaceId,
    sellerSku: input.sellerSku,
    asin: prepared.source.asin,
    productType: prepared.source.productType,
    sourceEvidence: prepared.source.sourceEvidence,
    expectedSourceParentSku: null,
    targetParentSku: input.targetParentSku,
    targetAsin: prepared.target.asin,
    variationTheme: input.variationTheme,
    dimensionNames: [...input.dimensionNames],
    dimensionValues: structuredClone(input.dimensionValues),
    childSchemaChecksum: prepared.target.childSchemaChecksum,
    targetEvidence: prepared.target.targetEvidence,
    ptdEvidence: prepared.target.ptdEvidence,
  };
  return {
    mode: prepared.mode,
    descriptor,
    sourceParentSku: null,
    targetParentSku: input.targetParentSku,
    variationTheme: input.variationTheme,
    dimensionSignature,
    childSchemaChecksumHash: createHash("sha256")
      .update(prepared.target.childSchemaChecksum)
      .digest("hex"),
  };
}

function validationResult(
  prepared: PreparedDescriptor,
  issues: ListingIssue[],
): VariationMovePreview {
  return {
    mode: prepared.mode,
    action: prepared.descriptor.action,
    status: prepared.mode === "demo" ? "SIMULATED" : "VALID",
    marketplaceId: prepared.descriptor.marketplaceId,
    sellerSku: prepared.descriptor.sellerSku,
    sourceParentSku: prepared.sourceParentSku,
    targetParentSku: prepared.targetParentSku,
    variationTheme: prepared.variationTheme,
    validatedAt: new Date().toISOString(),
    issues,
    notice: prepared.mode === "demo"
      ? "展示模式預檢完成；Amazon 不會收到變體寫入。"
      : `Amazon 已通過${prepared.descriptor.action === "detach" ? "解除舊 parent" : "加入新 parent"}預檢；尚未寫入。`,
  };
}

async function validateDescriptor(
  gateway: VariationMoveGateway,
  prepared: PreparedDescriptor,
): Promise<ListingIssue[]> {
  const receipt = await gateway.validationPreview(prepared.descriptor);
  const requestId = publicSpApiRequestId(receipt.requestId);
  const issues = publicIssues(receipt.issues);
  if (
    receipt.status === "INVALID" ||
    issues.some((issue) => issue.severity === "ERROR")
  ) {
    throw new SpApiError(
      issues.find((issue) => issue.severity === "ERROR")?.message ||
        `Amazon ${prepared.descriptor.action === "detach" ? "解除變體" : "加入變體"} Validation Preview 未通過，尚未寫入任何關係。`,
      {
        status: 422,
        code: "VALIDATION_FAILED",
        requestId,
        issues,
        operation: "patchListingsItemPreview",
      },
    );
  }
  if (receipt.status !== "VALID") {
    throw new SpApiError(
      "Amazon 變體預檢沒有回傳明確的 VALID 狀態，為避免誤改，已停止送出。",
      {
        status: 502,
        code: "VALIDATION_STATUS_UNKNOWN",
        requestId,
        issues,
        operation: "patchListingsItemPreview",
      },
    );
  }
  return issues;
}

function preCommitFailure(error: unknown): never {
  if (error instanceof SpApiPreCommitError) throw error;
  const cause = error instanceof SpApiError
    ? error
    : new SpApiError(
      "變體正式寫入前的重新讀取或 Validation Preview 失敗。",
      {
        status: 500,
        code: "PRECOMMIT_FAILED",
        operation: "patchListingsItemPreview",
      },
    );
  throw new SpApiPreCommitError(cause);
}

async function prepareCommit(
  gateway: VariationMoveGateway,
  input: VariationMoveInput,
  fence: ListingWriteExecutionFence,
): Promise<PreparedDescriptor> {
  try {
    await fence.assertCurrent();
    const prepared = await prepareDescriptor(gateway, input);
    if (prepared.mode === "live") await validateDescriptor(gateway, prepared);
    await fence.assertCurrent();
    return prepared;
  } catch (error) {
    return preCommitFailure(error);
  }
}

function writeEvidence(prepared: PreparedDescriptor): VariationMoveWriteEvidence {
  return {
    version: 1,
    action: prepared.descriptor.action,
    marketplaceId: prepared.descriptor.marketplaceId,
    sellerSku: prepared.descriptor.sellerSku,
    asin: prepared.descriptor.asin,
    productType: prepared.descriptor.productType,
    fulfillment: "FBA",
    sourceParentSku: prepared.sourceParentSku,
    targetParentSku: prepared.targetParentSku,
    targetAsin: prepared.descriptor.action === "attach"
      ? prepared.descriptor.targetAsin
      : null,
    variationTheme: prepared.variationTheme,
    dimensionNames: [...prepared.descriptor.dimensionNames],
    dimensionSignature: prepared.dimensionSignature,
    childSchemaChecksumHash: prepared.childSchemaChecksumHash,
  };
}

async function assertPostWriteContext(
  fence: ListingWriteExecutionFence,
  requestId: string | null = null,
): Promise<void> {
  try {
    await fence.assertCurrent();
  } catch {
    throw new SpApiError(
      "Amazon 可能已接受變體請求，但執行環境在安全回查前改變；系統已禁止重送，請重新讀取 Amazon 確認。",
      {
        status: 503,
        code: "UPDATE_STATUS_UNKNOWN",
        requestId: publicSpApiRequestId(requestId),
        operation: "patchListingsItem",
      },
    );
  }
}

function observationMatches(
  prepared: PreparedDescriptor,
  observation: VariationMoveObservation,
): boolean {
  const descriptor = prepared.descriptor;
  if (
    observation.marketplaceId !== descriptor.marketplaceId ||
    observation.sellerSku !== descriptor.sellerSku ||
    observation.asin !== descriptor.asin ||
    observation.productType !== descriptor.productType ||
    observation.fulfillment !== "FBA"
  ) return false;
  if (descriptor.action === "detach") {
    return observation.role === "standalone" &&
      observation.parentSku === null &&
      observation.parentageLevel === null &&
      observation.attributeParentSku === null &&
      observation.relationshipType === null &&
      observation.variationTheme === null &&
      observation.relationshipAttributesAbsent &&
      observation.explicitStandalone;
  }
  return observation.role === "child" &&
    observation.parentSku === descriptor.targetParentSku &&
    observation.parentageLevel?.toLowerCase() === "child" &&
    observation.attributeParentSku === descriptor.targetParentSku &&
    observation.relationshipType?.toLowerCase() === "variation" &&
    observation.variationTheme === descriptor.variationTheme &&
    !observation.relationshipAttributesAbsent &&
    observation.dimensionSignature === prepared.dimensionSignature;
}

const VARIATION_READBACK_DELAYS_MS = [
  0,
  1_000,
  1_300,
  1_600,
  1_900,
  2_000,
  2_000,
] as const;

async function verifyReadback(
  gateway: VariationMoveGateway,
  prepared: PreparedDescriptor,
  fence: ListingWriteExecutionFence,
  requestId: string | null,
  delay: (milliseconds: number) => Promise<void>,
): Promise<void> {
  for (const delayMs of VARIATION_READBACK_DELAYS_MS) {
    if (delayMs > 0) await delay(delayMs);
    await assertPostWriteContext(fence, requestId);
    let observation: VariationMoveObservation;
    try {
      observation = await gateway.observe(prepared.descriptor);
    } catch (error) {
      throw new SpApiError(
        "Amazon 已接受變體請求，但唯讀回查無法完成。系統已禁止直接重送。",
        {
          status: 503,
          code: "UPDATE_STATUS_UNKNOWN",
          requestId: error instanceof SpApiError
            ? publicSpApiRequestId(error.requestId)
            : null,
          operation: "getListingsItem",
        },
      );
    }
    await assertPostWriteContext(fence, requestId);
    if (observationMatches(prepared, observation)) return;
  }
  throw new SpApiError(
    "Amazon 已接受變體請求，但回查尚未證明完成。系統已禁止直接重送。",
    {
      status: 409,
      code: "UPDATE_STATUS_UNKNOWN",
      requestId: publicSpApiRequestId(requestId),
      operation: "getListingsItem",
    },
  );
}

function durableResult(input: Readonly<{
  prepared: PreparedDescriptor;
  verified: boolean;
  completedAt: string;
  submissionId: string | null;
  requestId: string | null;
  issues: ListingIssue[];
}>): VariationMoveDurableResult {
  const descriptor = input.prepared.descriptor;
  return {
    mode: input.prepared.mode,
    action: descriptor.action,
    status: input.prepared.mode === "demo" ? "SIMULATED" : "ACCEPTED",
    marketplaceId: descriptor.marketplaceId,
    sellerSku: descriptor.sellerSku,
    sourceParentSku: input.prepared.sourceParentSku,
    targetParentSku: input.prepared.targetParentSku,
    variationTheme: input.prepared.variationTheme,
    verified: input.verified,
    completedAt: input.completedAt,
    submissionId: publicSpApiIssueIdentifier(input.submissionId),
    requestId: publicSpApiRequestId(input.requestId),
    issues: publicIssues(input.issues),
    notice: input.prepared.mode === "demo"
      ? "展示模式完成；Amazon 真實變體關係沒有變更。"
      : descriptor.action === "detach"
        ? "Amazon 已接受解除，且唯讀回查確認 parent 關係欄位已移除。"
        : `Amazon 已接受加入，且唯讀回查確認 parent 為 ${descriptor.targetParentSku}、theme 與必要維度一致。`,
    _writeEvidence: writeEvidence(input.prepared),
  };
}

function dispatchedResult(
  prepared: PreparedDescriptor,
): VariationMoveDurableResult {
  const result = durableResult({
    prepared,
    verified: false,
    completedAt: new Date().toISOString(),
    submissionId: null,
    requestId: null,
    issues: [],
  });
  return {
    ...result,
    status: "DISPATCHED",
    notice: "Amazon 正式 PATCH 已進入送出邊界；等待 receipt 與 canonical readback。",
  };
}

function publicVariationMoveResult(
  result: VariationMoveDurableResult,
  expectedMode: "live" | "demo",
): VariationMoveResult {
  const evidence = result._writeEvidence;
  const validTimestamp = typeof result.completedAt === "string" &&
    Number.isFinite(Date.parse(result.completedAt)) &&
    new Date(result.completedAt).toISOString() === result.completedAt;
  const validModeStatus = result.mode === expectedMode && (
    (result.mode === "live" && result.status === "ACCEPTED") ||
    (result.mode === "demo" && result.status === "SIMULATED")
  );
  const evidenceIsRecord = isPlainRecord(evidence) &&
    hasExactKeys(evidence, VARIATION_WRITE_EVIDENCE_KEYS);
  const validActionEvidence = evidenceIsRecord && result.action === "detach"
    ? typeof result.sourceParentSku === "string" &&
      parseSellerSku(result.sourceParentSku) === result.sourceParentSku &&
      result.targetParentSku === null &&
      result.variationTheme === null &&
      evidence.targetAsin === null &&
      Array.isArray(evidence.dimensionNames) &&
      evidence.dimensionNames.length === 0 &&
      evidence.dimensionSignature === null &&
      evidence.childSchemaChecksumHash === null
    : evidenceIsRecord && result.action === "attach" &&
      result.sourceParentSku === null &&
      typeof result.targetParentSku === "string" &&
      parseSellerSku(result.targetParentSku) === result.targetParentSku &&
      typeof result.variationTheme === "string" &&
      result.variationTheme.length > 0 &&
      result.variationTheme === result.variationTheme.trim() &&
      parseVariationDimensionNames(evidence.dimensionNames) !== null &&
      typeof evidence.dimensionSignature === "string" &&
      evidence.dimensionSignature.length > 0 &&
      typeof evidence.childSchemaChecksumHash === "string" &&
      /^[a-f0-9]{64}$/u.test(evidence.childSchemaChecksumHash) &&
      (result.mode === "demo"
        ? evidence.targetAsin === null || exactAsin(evidence.targetAsin)
        : exactAsin(evidence.targetAsin));
  const validEvidence = evidenceIsRecord &&
    evidence.version === 1 &&
    evidence.action === result.action &&
    evidence.marketplaceId === result.marketplaceId &&
    evidence.sellerSku === result.sellerSku &&
    exactAsin(evidence.asin) &&
    exactProductType(evidence.productType) &&
    evidence.fulfillment === "FBA" &&
    evidence.sourceParentSku === result.sourceParentSku &&
    evidence.targetParentSku === result.targetParentSku &&
    evidence.variationTheme === result.variationTheme;
  if (
    !result.verified ||
    !validTimestamp ||
    !validModeStatus ||
    !validActionEvidence ||
    !validEvidence ||
    (result.action !== "detach" && result.action !== "attach") ||
    !marketplaceById(result.marketplaceId) ||
    parseSellerSku(result.sellerSku) !== result.sellerSku ||
    publicSpApiIssueIdentifier(result.submissionId) !== result.submissionId ||
    publicSpApiRequestId(result.requestId) !== result.requestId
  ) {
    throw new SpApiError(
      "變體寫入結果或持久安全證據無法精確核對，系統已禁止當作成功回傳。",
      { status: 503, code: "UPDATE_STATUS_UNKNOWN" },
    );
  }
  return {
    mode: result.mode,
    action: result.action,
    status: result.status,
    marketplaceId: result.marketplaceId,
    sellerSku: result.sellerSku,
    sourceParentSku: result.sourceParentSku,
    targetParentSku: result.targetParentSku,
    variationTheme: result.variationTheme,
    verified: true,
    completedAt: result.completedAt,
    submissionId: result.submissionId,
    requestId: result.requestId,
    issues: publicIssues(result.issues),
    notice: result.mode === "demo"
      ? "展示模式完成；Amazon 真實變體關係沒有變更。"
      : result.action === "detach"
        ? "Amazon 已接受解除，且唯讀回查確認 parent 關係欄位已移除。"
        : `Amazon 已接受加入，且唯讀回查確認 parent 為 ${result.targetParentSku}、theme 與必要維度一致。`,
  };
}

function canonicalMatchesInput(
  input: VariationMoveInput,
  canonical: VariationMoveCanonicalObservation,
): boolean {
  if (
    canonical.marketplaceId !== input.marketplaceId ||
    canonical.sellerSku !== input.sellerSku ||
    canonical.fulfillment !== "FBA" ||
    !canonical.familyComplete ||
    !exactAsin(canonical.asin) ||
    !exactProductType(canonical.productType)
  ) return false;
  if (input.action === "detach") {
    return canonical.role === "standalone" &&
      canonical.parentSku === null &&
      canonical.parentageLevel === null &&
      canonical.attributeParentSku === null &&
      canonical.relationshipType === null &&
      canonical.variationTheme === null &&
      canonical.relationshipAttributesAbsent &&
      canonical.explicitStandalone &&
      canonical.parentAsin === null &&
      canonical.parentProductType === null;
  }
  return canonical.role === "child" &&
    canonical.parentSku === input.targetParentSku &&
    exactAsin(canonical.parentAsin) &&
    canonical.parentProductType === canonical.productType &&
    canonical.parentageLevel?.toLowerCase() === "child" &&
    canonical.attributeParentSku === input.targetParentSku &&
    canonical.relationshipType?.toLowerCase() === "variation" &&
    canonical.variationTheme === input.variationTheme &&
    !canonical.relationshipAttributesAbsent &&
    exactDimensionNames(canonical.dimensionNames, input.dimensionNames) &&
    canonical.dimensionSignature === requestedDimensionSignature(input);
}

function canonicalMatchesEvidence(
  evidence: VariationMoveWriteEvidence,
  canonical: VariationMoveCanonicalObservation,
): boolean {
  if (
    canonical.mode !== "live" ||
    canonical.marketplaceId !== evidence.marketplaceId ||
    canonical.sellerSku !== evidence.sellerSku ||
    canonical.asin !== evidence.asin ||
    canonical.productType !== evidence.productType ||
    canonical.fulfillment !== "FBA" ||
    !canonical.familyComplete
  ) return false;
  if (evidence.action === "detach") {
    return canonical.role === "standalone" &&
      canonical.parentSku === null &&
      canonical.parentageLevel === null &&
      canonical.attributeParentSku === null &&
      canonical.relationshipType === null &&
      canonical.variationTheme === null &&
      canonical.relationshipAttributesAbsent &&
      canonical.explicitStandalone;
  }
  return canonical.role === "child" &&
    canonical.parentSku === evidence.targetParentSku &&
    canonical.parentAsin === evidence.targetAsin &&
    canonical.parentProductType === evidence.productType &&
    canonical.parentageLevel?.toLowerCase() === "child" &&
    canonical.attributeParentSku === evidence.targetParentSku &&
    canonical.relationshipType?.toLowerCase() === "variation" &&
    canonical.variationTheme === evidence.variationTheme &&
    !canonical.relationshipAttributesAbsent &&
    exactDimensionNames(canonical.dimensionNames, evidence.dimensionNames) &&
    canonical.dimensionSignature === evidence.dimensionSignature;
}

function reconcileVariationMoveWrite(
  response: unknown,
  operation: string,
  canonical: VariationMoveCanonicalObservation,
): VariationMoveDurableResult | null {
  if (!isPlainRecord(response) || !isPlainRecord(response._writeEvidence)) {
    return null;
  }
  const evidence = response._writeEvidence as VariationMoveWriteEvidence;
  const expectedOperation = evidence.action === "detach"
    ? "variation_detach"
    : "variation_attach";
  if (
    operation !== expectedOperation ||
    response.mode !== "live" ||
    (response.status !== "DISPATCHED" && response.status !== "ACCEPTED") ||
    !canonicalMatchesEvidence(evidence, canonical)
  ) return null;

  const reconciled: VariationMoveDurableResult = {
    mode: response.mode,
    action: evidence.action,
    status: "ACCEPTED",
    marketplaceId: evidence.marketplaceId,
    sellerSku: evidence.sellerSku,
    sourceParentSku: evidence.sourceParentSku,
    targetParentSku: evidence.targetParentSku,
    variationTheme: evidence.variationTheme,
    verified: true,
    completedAt: new Date().toISOString(),
    submissionId: publicSpApiIssueIdentifier(response.submissionId),
    requestId: publicSpApiRequestId(response.requestId),
    issues: publicIssues(response.issues),
    notice: evidence.action === "detach"
      ? "Amazon 已接受解除，且主程序唯讀回查確認 parent 關係欄位已移除。"
      : `Amazon 已接受加入，且主程序唯讀回查確認 parent 為 ${evidence.targetParentSku}、theme 與必要維度一致。`,
    _writeEvidence: structuredClone(evidence),
  };
  try {
    publicVariationMoveResult(reconciled, canonical.mode);
    return reconciled;
  } catch {
    return null;
  }
}

function publicLegacyVariationMoveResult(
  response: unknown,
  input: VariationMoveInput,
  canonical: VariationMoveCanonicalObservation,
): VariationMoveResult {
  const validTimestamp = isPlainRecord(response) &&
    typeof response.completedAt === "string" &&
    Number.isFinite(Date.parse(response.completedAt)) &&
    new Date(response.completedAt).toISOString() === response.completedAt;
  const exactLegacy = isPlainRecord(response) &&
    hasExactKeys(response, VARIATION_PUBLIC_RESULT_KEYS) &&
    response.mode === canonical.mode &&
    ((response.mode === "live" && response.status === "ACCEPTED") ||
      (response.mode === "demo" && response.status === "SIMULATED")) &&
    response.action === input.action &&
    response.marketplaceId === input.marketplaceId &&
    response.sellerSku === input.sellerSku &&
    response.sourceParentSku === input.expectedSourceParentSku &&
    response.targetParentSku === input.targetParentSku &&
    response.variationTheme === input.variationTheme &&
    response.verified === true &&
    validTimestamp &&
    publicSpApiIssueIdentifier(response.submissionId) === response.submissionId &&
    publicSpApiRequestId(response.requestId) === response.requestId &&
    canonicalMatchesInput(input, canonical);
  if (!exactLegacy) {
    throw new SpApiError(
      "舊版變體完成紀錄無法由目前 Amazon canonical read 精確核對，系統已禁止當作成功回傳。",
      { status: 503, code: "UPDATE_STATUS_UNKNOWN" },
    );
  }
  return {
    mode: response.mode as "live" | "demo",
    action: input.action,
    status: response.status as "ACCEPTED" | "SIMULATED",
    marketplaceId: input.marketplaceId,
    sellerSku: input.sellerSku,
    sourceParentSku: input.expectedSourceParentSku,
    targetParentSku: input.targetParentSku,
    variationTheme: input.variationTheme,
    verified: true,
    completedAt: response.completedAt as string,
    submissionId: publicSpApiIssueIdentifier(response.submissionId),
    requestId: publicSpApiRequestId(response.requestId),
    issues: publicIssues(response.issues),
    notice: response.mode === "demo"
      ? "展示模式完成；Amazon 真實變體關係沒有變更。"
      : input.action === "detach"
        ? "Amazon 已接受解除，且唯讀回查確認 parent 關係欄位已移除。"
        : `Amazon 已接受加入，且唯讀回查確認 parent 為 ${input.targetParentSku}、theme 與必要維度一致。`,
  };
}

function createVariationMoveMutationOperations(
  gateway: VariationMoveGateway,
  readbackDelay: (milliseconds: number) => Promise<void> = wait,
): VariationMoveMutationOperations {
  return {
    readCanonical: (input) => gateway.readCanonical(input),
    prepare: async (input) => {
      const prepared = await prepareAttachContext(
        gateway,
        input,
        "preparation",
      );
      assertSourceFamilyComplete(prepared.source);
      return {
        mode: prepared.mode,
        marketplaceId: input.marketplaceId,
        sellerSku: input.sellerSku,
        sourceParentSku: prepared.source.parentSku,
        targetParentSku: prepared.target.sellerSku,
        productType: prepared.source.productType,
        variationTheme: prepared.target.variationTheme,
        dimensionNames: [...prepared.target.dimensionNames],
        fields: prepared.fields,
        preparedAt: new Date().toISOString(),
        requestIds: prepared.requestIds,
        writable: prepared.mode === "live",
        blockers: prepared.mode === "demo"
          ? ["目前為展示模式；只能檢視流程，Amazon 不會收到變體寫入。"]
          : [],
        warnings: [
          prepared.source.parentSku
            ? "解除舊 parent 與加入新 parent 是兩個非原子階段；每階段都會獨立預檢、Notebook 鑰匙（Touch ID／Windows Hello）確認與回查。"
            : "此 SKU 目前沒有 parent；加入新 parent 前仍會重新確認為獨立 FBA SKU。",
          "必要欄位來自 Amazon CHILD PTD。",
        ],
        notice: prepared.mode === "demo"
          ? "展示資料模擬 CHILD PTD 欄位；不會寫入 Amazon。"
          : "已核對來源與目標 family、FBA 證據、product type、variation theme 與 CHILD PTD。",
      };
    },
    preview: async (input) => {
      const prepared = await prepareDescriptor(gateway, input);
      const issues = prepared.mode === "live"
        ? await validateDescriptor(gateway, prepared)
        : [];
      return validationResult(prepared, issues);
    },
    commit: async (input, control) => {
      const prepared = await prepareCommit(gateway, input, control.fence);
      if (prepared.mode === "demo") {
        await control.fence.assertCurrent();
        await gateway.replaceDemoRelationship(
          prepared.descriptor,
          control.fence,
        );
        await control.fence.assertCurrent();
        return durableResult({
          prepared,
          verified: true,
          completedAt: new Date().toISOString(),
          submissionId: null,
          requestId: null,
          issues: [],
        });
      }

      const receipt = await gateway.commitOnce(
        prepared.descriptor,
        control.fence,
        () => control.recordDurableEvidence(dispatchedResult(prepared)),
      );
      const requestId = publicSpApiRequestId(receipt.requestId);
      const issues = publicIssues(receipt.issues);
      if (receipt.status === "INVALID") {
        throw new SpApiError(
          issues.find((issue) => issue.severity === "ERROR")?.message ||
            "Amazon 未接受這次變體關係更新。",
          {
            status: 422,
            code: "UPDATE_REJECTED",
            requestId,
            issues,
            operation: "patchListingsItem",
          },
        );
      }
      if (receipt.status !== "ACCEPTED") {
        throw new SpApiError(
          "Amazon 已收到變體請求，但沒有回傳可確認的 ACCEPTED 或 INVALID 狀態。系統已禁止重送，請先回查 SKU。",
          {
            status: 503,
            code: "UPDATE_STATUS_UNKNOWN",
            requestId,
            issues,
            operation: "patchListingsItem",
          },
        );
      }

      const acceptedAt = new Date().toISOString();
      await control.recordDurableEvidence(durableResult({
        prepared,
        verified: false,
        completedAt: acceptedAt,
        submissionId: receipt.submissionId,
        requestId,
        issues,
      }));
      await assertPostWriteContext(control.fence, requestId);
      await verifyReadback(
        gateway,
        prepared,
        control.fence,
        requestId,
        readbackDelay,
      );
      return durableResult({
        prepared,
        verified: true,
        completedAt: new Date().toISOString(),
        submissionId: receipt.submissionId,
        requestId,
        issues,
      });
    },
  };
}

class VariationMoveMutations implements VariationMoveMutationsPort {
  private readonly context: SpExecutionContextAdapter;
  private readonly writeGate: MainWriteGatePort;
  private readonly operations: VariationMoveMutationOperations;

  constructor(input: Readonly<{
    context: SpExecutionContextAdapter;
    writeGate: MainWriteGatePort;
    operations: VariationMoveMutationOperations;
  }>) {
    this.context = input.context;
    this.writeGate = input.writeGate;
    this.operations = input.operations;
  }

  async handle(command: VariationMoveMutationCommand): Promise<ApiResponse> {
    if (command.operation === "prepare") {
      return this.prepareRoute(command.request);
    }
    if (command.operation === "preview") {
      return this.previewRoute(command.request);
    }
    return this.commitRoute(command.request);
  }

  private async reconcileIdentity(
    input: Readonly<{
      marketplaceId: MarketplaceId;
      sellerSku: string;
    }>,
    context: SpExecutionContext,
  ): Promise<VariationMoveCanonicalObservation> {
    const canonical = await this.operations.readCanonical(input);
    if (
      canonical.marketplaceId !== input.marketplaceId ||
      canonical.sellerSku !== input.sellerSku ||
      canonical.mode !== context.mode
    ) {
      throw new SpApiError(
        "變體 canonical read 不屬於目前的 Amazon 執行環境，已停止使用。",
        { status: 409, code: "SP_CONTEXT_INVALIDATED" },
      );
    }
    await this.context.assertCurrent(context);
    await this.writeGate.reconcile({
      context,
      marketplaceId: input.marketplaceId,
      sellerSku: input.sellerSku,
      operations: ["variation_detach", "variation_attach"],
      snapshot: canonical,
      project: (response, operation, snapshot) =>
        reconcileVariationMoveWrite(response, operation, snapshot),
    });
    await this.context.assertCurrent(context);
    return canonical;
  }

  private async prepareRoute(request: ApiRequest): Promise<ApiResponse> {
    const marketplaceId = parseMarketplace(request.query.marketplaceId);
    const sellerSku = parseSellerSku(request.query.sku);
    const targetParentSku = parseSellerSku(request.query.targetSku);
    if (!marketplaceId || !sellerSku || !targetParentSku) {
      return invalid("請選擇站點並提供來源 SKU 與目標 parent SKU。");
    }
    if (sellerSku === targetParentSku) {
      return invalid("來源 SKU 與目標 parent 不能相同。");
    }
    try {
      const context = await this.context.capture(marketplaceId);
      await this.reconcileIdentity({ marketplaceId, sellerSku }, context);
      const result = await this.operations.prepare({
        marketplaceId,
        sellerSku,
        targetParentSku,
      });
      await this.context.assertCurrent(context);
      return json(result);
    } catch (error) {
      return routeError(error, "準備變體必要欄位時發生未預期的錯誤。");
    }
  }

  private mutationInput(request: ApiRequest):
    | (VariationMoveInput & { idempotencyKey: string })
    | ApiResponse {
    const body = bodyRecord(request);
    if (!body) {
      return invalid(
        "變體請求必須使用 JSON。",
        415,
        "UNSUPPORTED_MEDIA_TYPE",
      );
    }
    const marketplaceId = parseMarketplace(body.marketplaceId);
    const sellerSku = parseSellerSku(body.sellerSku);
    const action = body.action === "detach" || body.action === "attach"
      ? body.action
      : null;
    if (!marketplaceId || !sellerSku || !action) {
      return invalid("變體請求缺少有效的站點、Seller SKU 或操作階段。");
    }
    const idempotencyKey = typeof body.idempotencyKey === "string"
      ? body.idempotencyKey
      : "";
    if (action === "detach") {
      const expectedSourceParentSku = parseSellerSku(
        body.expectedSourceParentSku,
      );
      if (
        !expectedSourceParentSku ||
        sellerSku === expectedSourceParentSku ||
        body.targetParentSku !== null ||
        body.variationTheme !== null ||
        !Array.isArray(body.dimensionNames) ||
        body.dimensionNames.length !== 0 ||
        !isPlainRecord(body.dimensionValues) ||
        Object.keys(body.dimensionValues).length !== 0
      ) {
        return invalid(
          "解除變體請求必須只包含查詢時核對的舊 parent，不可夾帶目標 family 資料。",
        );
      }
      return {
        action,
        marketplaceId,
        sellerSku,
        expectedSourceParentSku,
        targetParentSku: null,
        variationTheme: null,
        dimensionNames: [],
        dimensionValues: {},
        idempotencyKey,
      };
    }
    const targetParentSku = parseSellerSku(body.targetParentSku);
    const variationTheme = typeof body.variationTheme === "string" &&
        body.variationTheme.trim().length > 0 &&
        body.variationTheme.trim().length <= 120 &&
        !/[\u0000-\u001f\u007f]/u.test(body.variationTheme)
      ? body.variationTheme.trim()
      : null;
    const dimensionNames = parseVariationDimensionNames(body.dimensionNames);
    const dimensionValues = dimensionNames
      ? parseVariationDimensionValues(body.dimensionValues, dimensionNames)
      : null;
    if (
      !targetParentSku ||
      !variationTheme ||
      !dimensionNames ||
      !dimensionValues ||
      sellerSku === targetParentSku ||
      body.expectedSourceParentSku !== null
    ) {
      return invalid(
        "綁定變體請求缺少有效的目標 parent、theme 或必要維度資料。",
      );
    }
    return {
      action,
      marketplaceId,
      sellerSku,
      expectedSourceParentSku: null,
      targetParentSku,
      variationTheme,
      dimensionNames,
      dimensionValues,
      idempotencyKey,
    };
  }

  private binding(
    input: VariationMoveInput,
    context: SpExecutionContext,
    key: string,
  ): WriteBinding {
    return {
      family: "variation-move",
      previewKey: key,
      context,
      intents: [{
        intentId: "primary",
        operation: input.action === "detach"
          ? "variation_detach"
          : "variation_attach",
        marketplaceId: input.marketplaceId,
        sellerSku: input.sellerSku,
        idempotencyKey: key,
        proposalFingerprint: proposalFingerprint(input),
      }],
    };
  }

  private async previewRoute(request: ApiRequest): Promise<ApiResponse> {
    const input = this.mutationInput(request);
    if ("status" in input) return input;
    try {
      const context = await this.context.capture(input.marketplaceId);
      await this.reconcileIdentity(input, context);
      const result = await this.operations.preview(input);
      await this.context.assertCurrent(context);
      const key = validIdempotencyKey(input.idempotencyKey);
      if (key) {
        await this.writeGate.stagePreview(this.binding(input, context, key));
      }
      return json(result);
    } catch (error) {
      return error instanceof MainWriteGateError
        ? invalid(error.message, error.status, error.code)
        : routeError(error, "Amazon 變體預檢時發生未預期的錯誤。");
    }
  }

  private async commitRoute(request: ApiRequest): Promise<ApiResponse> {
    const input = this.mutationInput(request);
    if ("status" in input) return input;
    const key = validIdempotencyKey(input.idempotencyKey);
    if (!key) {
      return invalid("這次變體預檢確認資訊已失效，請重新執行。");
    }
    const context = await this.context.capture(input.marketplaceId);
    const approvalReason = input.action === "detach"
      ? `確認解除變體｜${marketplaceCode(input.marketplaceId)} ${input.sellerSku}｜原 parent ${input.expectedSourceParentSku}`
      : `確認加入變體｜${marketplaceCode(input.marketplaceId)} ${input.sellerSku} → ${input.targetParentSku}｜${input.variationTheme}`;
    try {
      const result = await this.writeGate.execute({
        binding: this.binding(input, context, key),
        approvalReason,
        run: (session) => session.attempt<VariationMoveDurableResult>({
          intentId: "primary",
          execute: (control) => this.operations.commit(input, {
            fence: { assertCurrent: control.assertCurrent },
            recordDurableEvidence:
              control.recordDurableEvidence ?? control.recordAccepted,
          }),
          }),
      });
      await this.context.assertCurrent(context);
      if (isPlainRecord(result) && "_writeEvidence" in result) {
        return json(publicVariationMoveResult(result, context.mode));
      }
      const canonical = await this.operations.readCanonical(input);
      await this.context.assertCurrent(context);
      return json(publicLegacyVariationMoveResult(result, input, canonical));
    } catch (error) {
      return error instanceof MainWriteGateError
        ? invalid(error.message, error.status, error.code)
        : routeError(
          error,
          "Amazon 變體寫入或回查時發生未預期的錯誤。",
        );
    }
  }
}

type VariationMoveMutationFactoryInput = Readonly<{
  context: SpExecutionContextAdapter;
  writeGate: MainWriteGatePort;
  readbackDelay?: (milliseconds: number) => Promise<void>;
  gateway: VariationMoveGateway;
}>;

export function createVariationMoveMutations(
  input: VariationMoveMutationFactoryInput,
): VariationMoveMutationsPort {
  return new VariationMoveMutations({
    context: input.context,
    writeGate: input.writeGate,
    operations: createVariationMoveMutationOperations(
      input.gateway,
      input.readbackDelay,
    ),
  });
}
