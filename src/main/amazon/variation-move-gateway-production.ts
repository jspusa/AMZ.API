import {
  resolveVariationPreviewRequirements,
  type VariationPreviewRejectionDetail,
} from "./variation-preview-requirements";
import type { ListingItemReadScope } from "./listing-item-read-scope";
import { createHash, randomUUID } from "node:crypto";
import type { MarketplaceId } from "../../shared/marketplaces";
import type {
  VariationFamilyMember,
  VariationFamilySnapshot,
} from "./variation-family";
import {
  listingSubmissionIssuesAreWellFormed,
} from "./business-pricing-evidence";
import {
  readVariationItem,
  readVariationItemAndFamily,
  type VariationItemReadResult,
} from "./variation-family-reads";
import {
  readProductTypeDefinition,
  type ListingsReadAdapter,
} from "./listings-reads";
import {
  normalizeListingIssues,
  throwListingsPayloadError,
  throwListingsReadError,
} from "./listings-response-error";
import {
  publicSpApiIssueIdentifier,
  publicSpApiListingIssues,
  publicSpApiRequestId,
  SpApiError,
  SpApiPreCommitError,
  type ListingIssue,
} from "./sp-api-error";
import type {
  ListingsWriteProduction,
  ListingsWriteReceipt,
} from "./listings-write-production";
import { classifyUnboundVariationEvidence } from
  "./unbound-variation-audit";
import {
  assertVariationDetached,
  buildVariationAttachBody,
  preservedStandaloneVariationTheme,
  buildVariationDetachBody,
  variationDimensionSignature,
  variationFieldDescriptors,
  preservedVariationDimensions,
  variationRelationshipSnapshot,
  VariationUpdateValidationError,
  type VariationPatchBody,
} from "./variation-update";
import type {
  VariationMoveAttachDescriptor,
  VariationMoveCanonicalObservation,
  VariationMoveCommitReceipt,
  VariationMoveDescriptor,
  VariationMoveGateway,
  VariationMoveGatewayPreparation,
  VariationMoveObservation,
  VariationMovePrepareRequest,
  VariationMovePtdEvidence,
  VariationMoveSourceEvidence,
  VariationMoveSourceObservation,
  VariationMoveTargetEvidence,
  VariationMoveTargetObservation,
  VariationMoveValidationReceipt,
} from "./variation-move-gateway";
import {
  variationRequiredFieldDescriptors,
  validateVariationRequiredValues,
  requiredValuePatches,
  variationAttributeSignatures,
  variationRequiredFieldChoices,
  resolveVariationRequiredFields,
  resolveVariationRequiredFieldChoices,
  type VariationRequiredFieldBlock,
} from "./variation-required-fields";
import { preservedRequiredFieldDescriptors, preservedRequiredValuePatches,
  selectPreservedRequiredValues, wholeVariationAttributeSignatures } from "./variation-preserved-required-fields";

const requirementsChecksum = (schema: unknown, checksum: string | null): string | null =>
  schema && checksum ? createHash("sha256").update(JSON.stringify([checksum, schema])).digest("hex") : null;

type VariationMoveTransportReply = ListingsWriteReceipt;

export type VariationMoveGatewayProductionDependencies = Readonly<{
  listings: ListingsReadAdapter;
  resolveMode(marketplaceId: MarketplaceId): "live" | "demo";
  credentialGeneration(): number;
  readDemoFamily(
    marketplaceId: MarketplaceId,
    sellerSku: string,
  ): VariationFamilySnapshot;
  write: ListingsWriteProduction;
}>;

type EvidenceBase = Readonly<{
  nonce: string;
  generation: number;
  mode: "live" | "demo";
  action: "detach" | "attach";
  marketplaceId: MarketplaceId;
  sellerSku: string;
  expectedSourceParentSku: string | null;
  targetParentSku: string | null;
}>;

type StandaloneSourceEvidence = Readonly<{
  profile: VariationItemReadResult["profile"];
  relationships: unknown;
  role: VariationFamilyMember["role"];
  parentSku: string | null;
  listingFulfillmentEvidence: "FBA" | "OTHER";
}>;

type SourceEvidenceRecord = EvidenceBase &
  Readonly<{
    standalone?: StandaloneSourceEvidence;
    requiredSchema?: unknown;
    requiredSchemaChecksum?: string | null;
    requiredIssueKey?: string;
    requiredIssueNames?: readonly string[];
    requiredAutomaticNames?: readonly string[];
    requiredIssueChoices?: readonly string[];
    asin: string | null;
    productType: string | null;
    attributes: Record<string, unknown> | undefined;
    singleMarketplaceScope?: ListingItemReadScope;
  }>;

type TargetEvidenceRecord = EvidenceBase & Readonly<{
  targetFamilySignature?: string;
  asin: string | null;
  productType: string | null;
  variationTheme: string | null;
  dimensionNames: readonly string[];
}>;

type PtdEvidenceRecord = EvidenceBase & Readonly<{
  productType: string | null;
  checksum: string | null;
  schema: unknown;
}>;

type DemoRelationshipOverride = Readonly<{
  role: "child" | "standalone";
  parentSku: string | null;
  variationTheme: string | null;
  dimensionValues: Readonly<Record<string, unknown>> | null;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactProductType(value: string | null): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value === value.trim() &&
    value.toUpperCase() !== "PRODUCT";
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

function relationshipValidationError(error: unknown): never {
  if (error instanceof VariationUpdateValidationError) {
    throw new SpApiError(error.message, {
      status: 409,
      code: error.code,
    });
  }
  throw error;
}

function relationshipSnapshot(
  marketplaceId: MarketplaceId,
  attributes: Record<string, unknown> | undefined,
) {
  try {
    return variationRelationshipSnapshot({ marketplaceId, attributes });
  } catch (error) {
    return relationshipValidationError(error);
  }
}

function relationshipAttributesAbsent(
  marketplaceId: MarketplaceId,
  attributes: Record<string, unknown> | undefined,
): boolean {
  try {
    assertVariationDetached({ marketplaceId, attributes });
    return true;
  } catch {
    return false;
  }
}

function valuesForDimensions(
  attributes: Record<string, unknown> | undefined,
  marketplaceId: MarketplaceId,
  dimensionNames: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(
    dimensionNames.map((name) => {
      const raw = attributes?.[name];
      const invalidValues = raw !== undefined && (!Array.isArray(raw) || raw.some((value) =>
        !isRecord(value) || (value.marketplace_id !== undefined && (
          typeof value.marketplace_id !== "string" || !value.marketplace_id ||
          value.marketplace_id !== value.marketplace_id.trim()
        ))));
      if (invalidValues) {
        throw new SpApiError(
          `${name} 的 Amazon 舊值或站點條件無法完整核對，請重新讀取。`,
          { status: 409, code: "VARIATION_TARGET_DIMENSIONS_INCOMPLETE" },
        );
      }
      const values = (Array.isArray(raw) ? raw : [])
        .filter((value) => {
          const itemMarketplace = value.marketplace_id;
          return !itemMarketplace || itemMarketplace === marketplaceId;
        })
        .map((value) => structuredClone(value));
      return [name, values];
    }),
  );
}

function variationTargetParent(
  family: VariationFamilySnapshot,
): VariationFamilyMember {
  return family.queried.role === "parent"
    ? family.queried
    : family.parent ?? family.queried;
}

/** Stable target facts only; request IDs, retrieval times and unrelated content are excluded. */
function targetFamilySignature(snapshot: Awaited<ReturnType<typeof readVariationItemAndFamily>>): string {
  const family = snapshot.family;
  const parent = variationTargetParent(family);
  const children = snapshot.childRows.map((row) => [
    row.member.sellerSku, row.member.asin, row.member.productType, row.member.role,
    row.member.parentSku, row.member.fba, row.member.variationTheme,
    wholeVariationAttributeSignatures(Object.fromEntries(family.dimensionNames.map((name) =>
      [name, row.payload.attributes?.[name]]))),
  ]).sort((left, right) => String(left[0]).localeCompare(String(right[0])));
  return createHash("sha256").update(JSON.stringify([
    parent.sellerSku, parent.asin, parent.productType, parent.role, parent.parentSku,
    parent.variationTheme, [...parent.childSkus].sort(), family.familyComplete,
    family.variationTheme, [...family.dimensionNames].sort(), children,
  ])).digest("hex");
}

function ptdChecksum(envelope: unknown): string | null {
  if (!isRecord(envelope) || !isRecord(envelope.schema)) return null;
  const checksum = envelope.schema.checksum;
  return typeof checksum === "string" ? checksum : null;
}

async function readChildSchema(
  listings: ListingsReadAdapter,
  marketplaceId: MarketplaceId,
  productType: string,
): Promise<Readonly<{
  schema: unknown;
  checksum: string | null;
  requestId: string | null;
}>> {
  const result = await readProductTypeDefinition(listings, {
    intent: "variation-child",
    marketplaceId,
    productType,
  });
  if (result.status < 200 || result.status >= 300) {
    return throwListingsReadError(result, "getDefinitionsProductType");
  }
  if (!isRecord(result.schemaEnvelope)) {
    throw new SpApiError("Amazon CHILD PTD schema 格式無法辨識。", {
      status: 502,
      code: "PRODUCT_TYPE_SCHEMA_UNAVAILABLE",
      requestId: publicSpApiRequestId(result.requestId),
      operation: "getDefinitionsProductType",
    });
  }
  return {
    schema: structuredClone(result.schemaEnvelope),
    checksum: ptdChecksum(result.envelope),
    requestId: publicSpApiRequestId(result.requestId),
  };
}

function standaloneSourceEvidence(
  result: VariationItemReadResult,
): StandaloneSourceEvidence {
  return {
    profile: result.profile,
    relationships: structuredClone(result.payload.relationships),
    role: result.member.role,
    parentSku: result.member.parentSku,
    listingFulfillmentEvidence: result.member.fba ? "FBA" : "OTHER",
  };
}

function provesStandalone(
  source: StandaloneSourceEvidence | undefined,
  marketplaceId: MarketplaceId,
): boolean {
  if (!source) return false;
  return classifyUnboundVariationEvidence({ ...source, marketplaceId }).kind === "unbound" &&
    source.role === "standalone" &&
    source.parentSku === null;
}

function explicitStandalone(
  result: VariationItemReadResult,
  marketplaceId: MarketplaceId,
): boolean {
  return provesStandalone(standaloneSourceEvidence(result), marketplaceId);
}

function liveSourceObservation(
  input: Readonly<{
    marketplaceId: MarketplaceId;
    result: VariationItemReadResult;
    familyComplete: boolean;
    sourceEvidence: VariationMoveSourceEvidence;
  }>,
): VariationMoveSourceObservation {
  const relationship = relationshipSnapshot(
    input.marketplaceId,
    input.result.payload.attributes,
  );
  return {
    marketplaceId: input.marketplaceId,
    sellerSku: input.result.member.sellerSku,
    asin: input.result.member.asin,
    productType: input.result.member.productType || null,
    fulfillment: input.result.member.fba ? "FBA" : "OTHER",
    role: input.result.member.role,
    parentSku: input.result.member.parentSku,
    relationshipType: relationship.relationshipType,
    variationTheme: relationship.variationTheme,
    explicitStandalone: explicitStandalone(input.result, input.marketplaceId),
    familyComplete: input.familyComplete,
    sourceEvidence: input.sourceEvidence,
  };
}

function demoSchema(dimensionNames: readonly string[]): unknown {
  return {
    type: "object",
    properties: Object.fromEntries(dimensionNames.map((name) => [
      name,
      {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          required: ["value"],
          properties: {
            value: { type: "string" },
            language_tag: { type: "string" },
            marketplace_id: { type: "string" },
          },
        },
      },
    ])),
  };
}

function memberDimensionValues(
  member: VariationFamilyMember,
  marketplaceId: MarketplaceId,
  dimensionNames: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(dimensionNames.map((name) => {
    const values = member.dimensions.find((dimension) =>
      dimension.name === name)?.values ?? [];
    return [
      name,
      values.map((value) => ({ value, marketplace_id: marketplaceId })),
    ];
  }));
}

function demoAttributes(input: Readonly<{
  member: VariationFamilyMember;
  marketplaceId: MarketplaceId;
  override: DemoRelationshipOverride | null;
}>): Record<string, unknown> {
  const role = input.override?.role ?? input.member.role;
  const parentSku = input.override?.parentSku ?? input.member.parentSku;
  const variationTheme = input.override?.variationTheme ??
    input.member.variationTheme;
  const dimensions = input.override?.dimensionValues ??
    memberDimensionValues(
      input.member,
      input.marketplaceId,
      input.member.dimensions.map((dimension) => dimension.name),
    );
  return {
    ...structuredClone(dimensions),
    ...(role === "child" && parentSku && variationTheme
      ? {
          parentage_level: [{
            value: "child",
            marketplace_id: input.marketplaceId,
          }],
          child_parent_sku_relationship: [{
            parent_sku: parentSku,
            child_relationship_type: "variation",
            marketplace_id: input.marketplaceId,
          }],
          variation_theme: [{
            name: variationTheme,
            marketplace_id: input.marketplaceId,
          }],
        }
      : {}),
  };
}

function throwTransportError(
  reply: VariationMoveTransportReply,
  operation: "read" | "write",
): never {
  return throwListingsPayloadError({
    status: reply.status,
    operation,
    apiOperation: operation === "read"
      ? "patchListingsItemPreview"
      : "patchListingsItem",
    requestId: publicSpApiRequestId(reply.requestId),
    retryAfter: reply.retryAfter,
    payload: isRecord(reply.payload) ? reply.payload : null,
  });
}

function receiptIssues(payload: unknown): ListingIssue[] {
  return publicIssues(isRecord(payload)
    ? normalizeListingIssues(payload.issues)
    : []);
}

function throwRequiredFieldExplanation(
  reply: VariationMoveTransportReply,
  reason: VariationRequiredFieldBlock | "PTD_UNDECLARED" |
    "METADATA_REJECTED" | "HTTP_UNSUPPORTED",
  detail?: VariationPreviewRejectionDetail,
): never {
  const explanations = {
    VALUE_CONFLICT: "Amazon 預檢要求補填的欄位，在本次商品讀取中已有非空資料，不能直接視為空白欄位補填；為避免覆寫既有答案，已停止。請先在商品資料頁核對後重新讀取。",
    PTD_UNDECLARED: "Amazon 預檢要求的資料，在本次讀取的 CHILD PTD 沒有可確認的欄位定義；無法安全建立輸入欄，請先在商品資料頁核對後重新讀取。",
    METADATA_REJECTED: "Amazon 預檢含資料缺漏訊息，但回覆的欄位識別或格式未通過安全核對；無法安全建立輸入欄，請重新讀取商品後核對檢查詳情。",
    HTTP_UNSUPPORTED: "Amazon 此次回覆的 HTTP 狀態不支援補欄恢復；原請求仍被拒絕，請先處理檢查詳情中的連線、權限或服務問題。",
    PROTECTED: "Amazon 預檢要求的欄位屬於其他受管制的商品或變體資料，這個工作台不能代為修改；請在對應商品功能核對後重新讀取。",
    READONLY: "Amazon CHILD PTD 將預檢要求的欄位標為唯讀，這個工作台不能補填；請先在商品資料頁核對後重新讀取。",
    UNSUPPORTED: "Amazon 預檢要求的欄位結構或既有選擇條件，目前無法安全以表單補填；請先在商品資料頁核對後重新讀取。",
  };
  const http = Number.isInteger(reply.status) &&
      reply.status >= 100 && reply.status <= 599
    ? `（Amazon HTTP ${reply.status}）`
    : "";
  const diagnostic = detail ? `（診斷 ${detail}）` : "";
  const code = `VARIATION_REQUIREMENTS_${reason}`;
  if (!reply.ok) {
    try {
      throwTransportError(reply, "read");
    } catch (error) {
      if (!(error instanceof SpApiError)) throw error;
      // The original transport status/code/retry classification remains authoritative.
      throw new SpApiError(`${explanations[reason]}${http}${diagnostic}（${code}）`, {
        status: error.status,
        code: error.code,
        requestId: error.requestId,
        retryAfter: error.retryAfter,
        issues: error.issues,
        operation: error.operation,
        upstreamCode: error.upstreamCode,
      });
    }
  }
  throw new SpApiError(`${explanations[reason]}${http}${diagnostic}`, {
    status: 422,
    code,
    requestId: publicSpApiRequestId(reply.requestId),
    issues: receiptIssues(reply.payload),
    operation: "patchListingsItemPreview",
  });
}

function validationReceipt(
  reply: VariationMoveTransportReply,
): VariationMoveValidationReceipt {
  const wellFormed = isRecord(reply.payload) &&
    listingSubmissionIssuesAreWellFormed(reply.payload.issues);
  // Display sanitization must not erase a real ERROR and grant a Preview ticket.
  const rawError = wellFormed && Array.isArray(reply.payload.issues) &&
    reply.payload.issues.some((issue) => isRecord(issue) &&
      typeof issue.severity === "string" && issue.severity.toUpperCase() === "ERROR");
  const status = wellFormed &&
      (reply.payload.status === "VALID" || reply.payload.status === "INVALID")
    ? rawError ? "INVALID" : reply.payload.status
    : "UNKNOWN";
  return {
    status,
    requestId: publicSpApiRequestId(reply.requestId),
    issues: receiptIssues(reply.payload),
  };
}

function commitReceipt(
  reply: VariationMoveTransportReply,
): VariationMoveCommitReceipt {
  const wellFormed = isRecord(reply.payload) &&
    listingSubmissionIssuesAreWellFormed(reply.payload.issues) &&
    (!("submissionId" in reply.payload) ||
      reply.payload.submissionId === undefined ||
      reply.payload.submissionId === null ||
      typeof reply.payload.submissionId === "string");
  const status = wellFormed &&
      (reply.payload.status === "ACCEPTED" ||
        reply.payload.status === "INVALID")
    ? reply.payload.status
    : "UNKNOWN";
  return {
    status,
    submissionId: wellFormed
      ? publicSpApiIssueIdentifier(reply.payload.submissionId)
      : null,
    requestId: publicSpApiRequestId(reply.requestId),
    issues: receiptIssues(reply.payload),
  };
}

function preCommitTransportError(error: unknown): never {
  if (error instanceof SpApiPreCommitError) throw error;
  if (error instanceof SpApiError && error.code === "UPDATE_STATUS_UNKNOWN") {
    throw error;
  }
  const cause = error instanceof SpApiError
    ? error
    : new SpApiError(
      "變體正式 PATCH 送出前的本機 transport 準備失敗。",
      {
        status: 500,
        code: "PRECOMMIT_FAILED",
        operation: "patchListingsItem",
      },
    );
  throw new SpApiPreCommitError(cause);
}

/**
 * Creates the only production adapter below the Variation Move domain.
 * Opaque evidence objects are checked by identity and cannot cross IPC.
 */
export function createVariationMoveGatewayProduction(
  dependencies: VariationMoveGatewayProductionDependencies,
): VariationMoveGateway {
  let sourceEvidence = new WeakMap<object, SourceEvidenceRecord>();
  let targetEvidence = new WeakMap<object, TargetEvidenceRecord>();
  let ptdEvidence = new WeakMap<object, PtdEvidenceRecord>();
  const demoOverrides = new Map<string, DemoRelationshipOverride>();
  const requiredIssueHints = new Map<
    string,
    { names: string[]; choices: string[]; expiresAt: number }
  >();
  const requirementsKey = (base: EvidenceBase, asin: string | null, productType: string | null, schema: unknown, attributes: unknown, target: unknown) =>
    createHash("sha256").update(JSON.stringify([base.generation, base.mode, base.action, base.marketplaceId, base.sellerSku,
      base.expectedSourceParentSku, base.targetParentSku, asin, productType, schema, attributes, target])).digest("hex");
  const issueHintsFor = (key: string) => {
    const entry = requiredIssueHints.get(key);
    if (!entry || entry.expiresAt < Date.now()) {
      requiredIssueHints.delete(key);
      return { names: [], choices: [] };
    }
    return { names: [...entry.names], choices: [...entry.choices] };
  };
  let observedGeneration = dependencies.credentialGeneration();

  const demoKey = (marketplaceId: MarketplaceId, sellerSku: string) =>
    `${marketplaceId}\u0000${sellerSku}`;

  const ensureGeneration = () => {
    const generation = dependencies.credentialGeneration();
    if (generation !== observedGeneration) {
      sourceEvidence = new WeakMap();
      targetEvidence = new WeakMap();
      ptdEvidence = new WeakMap();
      demoOverrides.clear();
      requiredIssueHints.clear();
      observedGeneration = generation;
    }
    return generation;
  };

  const mintSource = (record: SourceEvidenceRecord) => {
    const evidence = Object.freeze({}) as VariationMoveSourceEvidence;
    sourceEvidence.set(evidence, record);
    return evidence;
  };
  const mintTarget = (record: TargetEvidenceRecord) => {
    const evidence = Object.freeze({}) as VariationMoveTargetEvidence;
    targetEvidence.set(evidence, record);
    return evidence;
  };
  const mintPtd = (record: PtdEvidenceRecord) => {
    const evidence = Object.freeze({}) as VariationMovePtdEvidence;
    ptdEvidence.set(evidence, record);
    return evidence;
  };

  const evidenceBase = (
    input: VariationMovePrepareRequest,
    mode: "live" | "demo",
    generation: number,
  ): EvidenceBase => ({
    nonce: randomUUID(),
    generation,
    mode,
    action: input.action,
    marketplaceId: input.marketplaceId,
    sellerSku: input.sellerSku,
    expectedSourceParentSku: input.action === "detach"
      ? input.expectedSourceParentSku
      : null,
    targetParentSku: input.action === "attach" ? input.targetParentSku : null,
  });

  const sourceRecordFor = (
    descriptor: VariationMoveDescriptor,
  ): SourceEvidenceRecord => {
    const record = sourceEvidence.get(descriptor.sourceEvidence);
    if (
      !record ||
      record.generation !== ensureGeneration() ||
      record.action !== descriptor.action ||
      record.marketplaceId !== descriptor.marketplaceId ||
      record.sellerSku !== descriptor.sellerSku ||
      record.asin !== descriptor.asin ||
      record.productType !== descriptor.productType ||
      record.expectedSourceParentSku !== descriptor.expectedSourceParentSku ||
      record.targetParentSku !== descriptor.targetParentSku
    ) {
      throw new SpApiError(
        "變體來源讀取證據已失效或與 PATCH 身分不一致，已停止送出。",
        { status: 409, code: "LISTING_IDENTITY_MISMATCH" },
      );
    }
    return record;
  };

  const attachRecordsFor = (
    descriptor: VariationMoveAttachDescriptor,
    source: SourceEvidenceRecord,
  ): Readonly<{
    target: TargetEvidenceRecord;
    ptd: PtdEvidenceRecord;
  }> => {
    const target = targetEvidence.get(descriptor.targetEvidence);
    const ptd = ptdEvidence.get(descriptor.ptdEvidence);
    if (
      !target ||
      !ptd ||
      target.nonce !== source.nonce ||
      ptd.nonce !== source.nonce ||
      target.generation !== source.generation ||
      ptd.generation !== source.generation ||
      target.marketplaceId !== descriptor.marketplaceId ||
      ptd.marketplaceId !== descriptor.marketplaceId ||
      target.targetParentSku !== descriptor.targetParentSku ||
      ptd.targetParentSku !== descriptor.targetParentSku ||
      target.asin !== descriptor.targetAsin ||
      target.productType !== descriptor.productType ||
      ptd.productType !== descriptor.productType ||
      target.variationTheme !== descriptor.variationTheme ||
      !sameDimensionNames(target.dimensionNames, descriptor.dimensionNames) ||
      ptd.checksum !== descriptor.childSchemaChecksum ||
      Object.keys(descriptor.preservedRequiredValues ?? {}).length > 0 &&
        (!descriptor.targetFamilySignature || descriptor.targetFamilySignature !== target.targetFamilySignature)
    ) {
      throw new SpApiError(
        "變體目標 family 或 CHILD PTD 證據已失效，已停止送出。",
        { status: 409, code: "VARIATION_TARGET_CHANGED" },
      );
    }
    return { target, ptd };
  };

  const patchBody = (descriptor: VariationMoveDescriptor): VariationPatchBody => {
    const source = sourceRecordFor(descriptor);
    try {
      const preservedValues = selectPreservedRequiredValues(preservedRequiredFieldDescriptors({
        schema: source.requiredSchema, attributes: source.attributes,
        marketplaceId: descriptor.marketplaceId, sellerSku: descriptor.sellerSku,
        singleMarketplaceScope: source.singleMarketplaceScope,
        dimensionNames: descriptor.dimensionNames, issueRequiredNames: source.requiredAutomaticNames ?? [],
      }), Object.keys(descriptor.preservedRequiredValues ?? {}));
      if (JSON.stringify(wholeVariationAttributeSignatures(preservedValues)) !==
        JSON.stringify(wholeVariationAttributeSignatures(descriptor.preservedRequiredValues))) {
        throw new VariationUpdateValidationError("保留的產品資料與本次來源原值不一致，請重新預檢。", "VARIATION_REQUIREMENTS_CHANGED");
      }
      const preservedPatches = preservedRequiredValuePatches(preservedValues);
      if (descriptor.action === "detach") {
        if (descriptor.requiredSchemaChecksum !== source.requiredSchemaChecksum) {
          throw new VariationUpdateValidationError("產品必填欄位的 PTD 已變更，請重新預檢。", "VARIATION_TARGET_CHANGED");
        }
        const requiredValues = validateVariationRequiredValues({
          fields: variationRequiredFieldDescriptors({ schema: source.requiredSchema,
            attributes: source.attributes, marketplaceId: descriptor.marketplaceId,
            dimensionNames: [], action: "detach", proposedValues: descriptor.requiredValues, issueRequiredNames: source.requiredIssueNames }),
          values: descriptor.requiredValues ?? {}, marketplaceId: descriptor.marketplaceId,
        });
        const body = buildVariationDetachBody({
          productType: descriptor.productType,
          marketplaceId: descriptor.marketplaceId,
          expectedParentSku: descriptor.expectedSourceParentSku,
          attributes: source.attributes,
        });
        return { ...body, patches: [...body.patches, ...requiredValuePatches(requiredValues, source.attributes, descriptor.marketplaceId), ...preservedPatches] };
      }
      if (!provesStandalone(source.standalone, descriptor.marketplaceId)) {
        throw new VariationUpdateValidationError(
          "來源 relationships 尚未完整證明沒有 parent，已停止加入新 parent。",
          "VARIATION_NOT_DETACHED",
        );
      }
      const records = attachRecordsFor(descriptor, source);
      if (descriptor.requiredSchemaChecksum !== source.requiredSchemaChecksum) throw new VariationUpdateValidationError("產品必填欄位的 PTD 已變更，請重新預檢。", "VARIATION_TARGET_CHANGED");
      const dimensionFields = variationFieldDescriptors({
        productTypeDefinition: records.ptd.schema,
        dimensionNames: [...descriptor.dimensionNames],
        attributes: source.attributes,
        marketplaceId: descriptor.marketplaceId,
      });
      const preserved = preservedVariationDimensions({
        fields: dimensionFields,
        marketplaceId: descriptor.marketplaceId,
        dimensionValues: descriptor.dimensionValues,
      });
      const requiredValues = validateVariationRequiredValues({
        fields: variationRequiredFieldDescriptors({ schema: records.ptd.schema,
          attributes: source.attributes, marketplaceId: descriptor.marketplaceId,
          dimensionNames: descriptor.dimensionNames, action: "attach",
          targetParentSku: descriptor.targetParentSku, variationTheme: descriptor.variationTheme,
          proposedValues: descriptor.requiredValues, dimensionValues: descriptor.dimensionValues, issueRequiredNames: source.requiredIssueNames }),
        values: descriptor.requiredValues ?? {}, marketplaceId: descriptor.marketplaceId,
      });
      const body = buildVariationAttachBody({
        productType: descriptor.productType,
        marketplaceId: descriptor.marketplaceId,
        targetParentSku: descriptor.targetParentSku,
        variationTheme: descriptor.variationTheme,
        dimensionNames: [...descriptor.dimensionNames],
        dimensionValues: { ...descriptor.dimensionValues },
        existingAttributes: source.attributes,
        preservedDimensionNames: Object.keys(preserved),
        sourceSellerSku: source.sellerSku,
        singleMarketplaceScope: source.singleMarketplaceScope,
      });
      return { ...body, patches: [...body.patches, ...requiredValuePatches(requiredValues, source.attributes, descriptor.marketplaceId), ...preservedPatches] };
    } catch (error) {
      return relationshipValidationError(error);
    }
  };

  const prepareDemo = async (
    input: VariationMovePrepareRequest,
    generation: number,
  ): Promise<VariationMoveGatewayPreparation> => {
    const base = evidenceBase(input, "demo", generation);
    const sourceFamily = dependencies.readDemoFamily(
      input.marketplaceId,
      input.sellerSku,
    );
    const sourceMember = sourceFamily.queried;
    const override = demoOverrides.get(demoKey(
      input.marketplaceId,
      input.sellerSku,
    )) ?? null;
    const sourceAttributes = demoAttributes({
      member: sourceMember,
      marketplaceId: input.marketplaceId,
      override,
    });
    const role = override?.role ?? sourceMember.role;
    const parentSku = override?.parentSku ?? sourceMember.parentSku;
    const variationTheme = override?.variationTheme ??
      sourceMember.variationTheme;
    const sourceCapability = mintSource({
      ...base,
      asin: sourceMember.asin,
      productType: sourceMember.productType || null,
      attributes: sourceAttributes,
      standalone: {
        profile: "relationships",
        relationships: role === "standalone" ? [] : undefined,
        role,
        parentSku,
        listingFulfillmentEvidence: sourceMember.fba ? "FBA" : "OTHER",
      },
    });
    const source: VariationMoveSourceObservation = {
      marketplaceId: input.marketplaceId,
      sellerSku: sourceMember.sellerSku,
      asin: sourceMember.asin,
      productType: sourceMember.productType || null,
      fulfillment: sourceMember.fba ? "FBA" : "OTHER",
      role,
      parentSku,
      relationshipType: role === "child" ? "variation" : null,
      variationTheme: role === "child" ? variationTheme : null,
      explicitStandalone: role === "standalone" && parentSku === null,
      familyComplete: sourceFamily.familyComplete,
      sourceEvidence: sourceCapability,
    };
    if (input.action === "detach") {
      return { action: "detach", mode: "demo", source, requestIds: [] };
    }

    const targetFamily = dependencies.readDemoFamily(
      input.marketplaceId,
      input.targetParentSku,
    );
    const targetMember = variationTargetParent(targetFamily);
    const schema = demoSchema(targetFamily.dimensionNames);
    const checksum = "demo-child-schema-v1";
    const targetCapability = mintTarget({
      ...base,
      asin: targetMember.asin,
      productType: targetMember.productType || null,
      variationTheme: targetFamily.variationTheme,
      dimensionNames: [...targetFamily.dimensionNames],
    });
    const ptdCapability = mintPtd({
      ...base,
      productType: sourceMember.productType || null,
      checksum,
      schema,
    });
    return {
      action: "attach",
      mode: "demo",
      source,
      target: {
        marketplaceId: input.marketplaceId,
        sellerSku: targetMember.sellerSku,
        asin: targetMember.asin,
        productType: targetMember.productType || null,
        role: targetMember.role,
        variationTheme: targetFamily.variationTheme,
        dimensionNames: [...targetFamily.dimensionNames],
        familyComplete: targetFamily.familyComplete,
        targetEvidence: targetCapability,
        childSchema: schema,
        childSchemaChecksum: checksum,
        ptdEvidence: ptdCapability,
        sourceDimensionValues: valuesForDimensions(
          sourceAttributes,
          input.marketplaceId,
          targetFamily.dimensionNames,
        ),
        children: input.purpose === "mutation"
          ? targetFamily.children.map((child) => ({
              sellerSku: child.sellerSku,
              dimensionValues: memberDimensionValues(
                child,
                input.marketplaceId,
                targetFamily.dimensionNames,
              ),
            }))
          : [],
      },
      requestIds: [],
    };
  };

  const prepareLive = async (
    input: VariationMovePrepareRequest,
    generation: number,
  ): Promise<VariationMoveGatewayPreparation> => {
    const base = evidenceBase(input, "live", generation);
    if (input.action === "detach") {
      const {
        item: sourceResult,
        family: sourceFamily,
      } = await readVariationItemAndFamily(dependencies.listings, input);
      const requiredSchema = exactProductType(sourceResult.member.productType)
        ? await readChildSchema(dependencies.listings, input.marketplaceId, sourceResult.member.productType)
        : { schema: null, checksum: null, requestId: null };
      const requiredIssueKey = requirementsKey(base, sourceResult.member.asin, sourceResult.member.productType, [requiredSchema.schema, requiredSchema.checksum],
        sourceResult.payload.attributes, null);
      const hints = issueHintsFor(requiredIssueKey);
      const requiredIssueNames = [
        ...new Set([
          ...hints.names,
          ...hints.choices.filter((name) =>
            Object.hasOwn(input.requiredValues ?? {}, name),
          ),
        ]),
      ];
      const requiredIssueChoices = hints.choices;
      const capability = mintSource({
        ...base,
        asin: sourceResult.member.asin,
        productType: sourceResult.member.productType || null,
        attributes: sourceResult.payload.attributes,
        singleMarketplaceScope: sourceResult.singleMarketplaceScope,
        requiredSchema: requiredSchema.schema,
        requiredSchemaChecksum: requirementsChecksum(requiredSchema.schema, requiredSchema.checksum),
        requiredIssueKey,
        requiredIssueNames,
        requiredAutomaticNames: hints.names,
        requiredIssueChoices,
      });
      return {
        action: "detach",
        mode: "live",
        source: {
          ...liveSourceObservation({
            marketplaceId: input.marketplaceId,
            result: sourceResult,
            familyComplete: sourceFamily.familyComplete,
            sourceEvidence: capability,
          }),
          requiredFields: variationRequiredFieldDescriptors({
          schema: requiredSchema.schema, attributes: sourceResult.payload.attributes,
          marketplaceId: input.marketplaceId, dimensionNames: [], action: "detach",
          proposedValues: input.requiredValues, issueRequiredNames: requiredIssueNames,
        }),
          requiredFieldChoices: variationRequiredFieldChoices(
            {
              schema: requiredSchema.schema,
              attributes: sourceResult.payload.attributes,
              marketplaceId: input.marketplaceId,
              dimensionNames: [],
              action: "detach",
              proposedValues: input.requiredValues,
            },
            requiredIssueChoices,
          ),
          requiredSchemaChecksum: requirementsChecksum(requiredSchema.schema, requiredSchema.checksum),
          preservedRequiredFields: preservedRequiredFieldDescriptors({
            schema: requiredSchema.schema, attributes: sourceResult.payload.attributes,
            marketplaceId: input.marketplaceId, sellerSku: input.sellerSku,
            singleMarketplaceScope: sourceResult.singleMarketplaceScope,
            dimensionNames: [], issueRequiredNames: hints.names,
          }),
        },
        requestIds: [
          sourceResult.requestId,
          requiredSchema.requestId,
          ...sourceFamily.requestIds,
        ].map(publicSpApiRequestId).filter(
          (value): value is string => value !== null,
        ),
      };
    }

    const [sourceSnapshot, targetSnapshot] = await Promise.all([
      readVariationItemAndFamily(dependencies.listings, input),
      readVariationItemAndFamily(dependencies.listings, {
        marketplaceId: input.marketplaceId,
        sellerSku: input.targetParentSku,
      }),
    ]);
    const sourceResult = sourceSnapshot.item;
    const sourceFamily = sourceSnapshot.family;
    const targetFamily = targetSnapshot.family;
    const targetMember = variationTargetParent(targetFamily);
    const canReadSchema = exactProductType(sourceResult.member.productType) &&
      targetMember.role === "parent" &&
      targetMember.productType === sourceResult.member.productType &&
      Boolean(targetFamily.variationTheme) &&
      targetFamily.dimensionNames.length > 0;
    const schema = canReadSchema
      ? await readChildSchema(
        dependencies.listings,
        input.marketplaceId,
        sourceResult.member.productType,
      )
      : { schema: null, checksum: null, requestId: null };
    const children = input.purpose === "mutation" &&
        targetMember.role === "parent"
      ? targetSnapshot.childRows
      : [];
    const targetSignature = targetFamilySignature(targetSnapshot);
    const requiredIssueKey = requirementsKey(base, sourceResult.member.asin, sourceResult.member.productType, [schema.schema, schema.checksum],
      sourceResult.payload.attributes, [targetMember.asin, targetMember.productType, targetMember.role,
        targetFamily.variationTheme, targetFamily.dimensionNames, input.dimensionValues, targetSignature]);
    const hints = issueHintsFor(requiredIssueKey);
    const requiredIssueNames = [
      ...new Set([
        ...hints.names,
        ...hints.choices.filter((name) =>
          Object.hasOwn(input.requiredValues ?? {}, name),
        ),
      ]),
    ];
    const requiredIssueChoices = hints.choices;
    const capability = mintSource({
      ...base,
      asin: sourceResult.member.asin,
      productType: sourceResult.member.productType || null,
      attributes: sourceResult.payload.attributes,
      standalone: standaloneSourceEvidence(sourceResult),
      singleMarketplaceScope: sourceResult.singleMarketplaceScope,
      requiredSchema: schema.schema,
      requiredSchemaChecksum: requirementsChecksum(schema.schema, schema.checksum),
      requiredIssueKey,
      requiredIssueNames,
      requiredAutomaticNames: hints.names,
      requiredIssueChoices,
    });
    const targetCapability = mintTarget({
      ...base,
      targetFamilySignature: targetSignature,
      asin: targetMember.asin,
      productType: targetMember.productType || null,
      variationTheme: targetFamily.variationTheme,
      dimensionNames: [...targetFamily.dimensionNames],
    });
    const ptdCapability = mintPtd({
      ...base,
      productType: sourceResult.member.productType || null,
      checksum: schema.checksum,
      schema: schema.schema,
    });
    let retainedVariationThemeSignature: string | undefined;
    if (
      explicitStandalone(sourceResult, input.marketplaceId) &&
      targetFamily.variationTheme
    ) {
      try {
        const retainedTheme = preservedStandaloneVariationTheme({
          marketplaceId: input.marketplaceId,
          variationTheme: targetFamily.variationTheme,
          attributes: sourceResult.payload.attributes,
          sourceSellerSku: sourceResult.member.sellerSku,
          singleMarketplaceScope: sourceResult.singleMarketplaceScope,
        });
        if (retainedTheme.length) {
          retainedVariationThemeSignature = variationAttributeSignatures(
            { variation_theme: retainedTheme },
            input.marketplaceId,
            true,
          ).variation_theme;
        }
      } catch (error) {
        return relationshipValidationError(error);
      }
    }
    const source = {
      ...liveSourceObservation({
        marketplaceId: input.marketplaceId,
        result: sourceResult,
        familyComplete: sourceFamily.familyComplete,
        sourceEvidence: capability,
      }),
      retainedVariationThemeSignature,
      preservedRequiredFields: preservedRequiredFieldDescriptors({
        schema: schema.schema, attributes: sourceResult.payload.attributes,
        marketplaceId: input.marketplaceId, sellerSku: input.sellerSku,
        singleMarketplaceScope: sourceResult.singleMarketplaceScope,
        dimensionNames: targetFamily.dimensionNames, issueRequiredNames: hints.names,
      }),
      requiredFields: variationRequiredFieldDescriptors({
      schema: schema.schema, attributes: sourceResult.payload.attributes,
      marketplaceId: input.marketplaceId, dimensionNames: targetFamily.dimensionNames,
      action: "attach", targetParentSku: input.targetParentSku, variationTheme: targetFamily.variationTheme,
      proposedValues: input.requiredValues, dimensionValues: input.dimensionValues, issueRequiredNames: requiredIssueNames,
    }),
      requiredFieldChoices: variationRequiredFieldChoices(
        {
          schema: schema.schema,
          attributes: sourceResult.payload.attributes,
          marketplaceId: input.marketplaceId,
          dimensionNames: targetFamily.dimensionNames,
          action: "attach",
          targetParentSku: input.targetParentSku,
          variationTheme: targetFamily.variationTheme,
          proposedValues: input.requiredValues,
          dimensionValues: input.dimensionValues,
        },
        requiredIssueChoices,
      ),
      requiredSchemaChecksum: requirementsChecksum(schema.schema, schema.checksum),
    };
    const target: VariationMoveTargetObservation = {
      targetFamilySignature: targetSignature,
      marketplaceId: input.marketplaceId,
      sellerSku: targetMember.sellerSku,
      asin: targetMember.asin,
      productType: targetMember.productType || null,
      role: targetMember.role,
      variationTheme: targetFamily.variationTheme,
      dimensionNames: [...targetFamily.dimensionNames],
      familyComplete: targetFamily.familyComplete,
      targetEvidence: targetCapability,
      childSchema: schema.schema,
      childSchemaChecksum: schema.checksum,
      ptdEvidence: ptdCapability,
      sourceDimensionValues: valuesForDimensions(
        sourceResult.payload.attributes,
        input.marketplaceId,
        targetFamily.dimensionNames,
      ),
      children: children.map((row) => ({
        sellerSku: row.member.sellerSku,
        dimensionValues: valuesForDimensions(
          row.payload.attributes,
          input.marketplaceId,
          targetFamily.dimensionNames,
        ),
      })),
    };
    return {
      action: "attach",
      mode: "live",
      source,
      target,
      requestIds: [
        sourceResult.requestId,
        schema.requestId,
        ...sourceFamily.requestIds,
        ...targetFamily.requestIds,
      ].map(publicSpApiRequestId).filter(
        (value): value is string => value !== null,
      ),
    };
  };

  const observeLive = async (
    descriptor: VariationMoveDescriptor,
  ): Promise<VariationMoveObservation> => {
    const result = await readVariationItem(dependencies.listings, descriptor);
    const relationship = relationshipSnapshot(
      descriptor.marketplaceId,
      result.payload.attributes,
    );
    let dimensionSignature: string | null = null;
    if (descriptor.action === "attach") {
      try {
        dimensionSignature = variationDimensionSignature({
          dimensionNames: [...descriptor.dimensionNames],
          dimensionValues: valuesForDimensions(
            result.payload.attributes,
            descriptor.marketplaceId,
            descriptor.dimensionNames,
          ),
          marketplaceId: descriptor.marketplaceId,
        });
      } catch {
        dimensionSignature = null;
      }
    }
    return {
      marketplaceId: descriptor.marketplaceId,
      attributeSignatures: variationAttributeSignatures(result.payload.attributes, descriptor.marketplaceId),
      exactAttributeSignatures: variationAttributeSignatures(result.payload.attributes, descriptor.marketplaceId, true),
      wholeAttributeSignatures: wholeVariationAttributeSignatures(result.payload.attributes),
      sellerSku: result.member.sellerSku,
      asin: result.member.asin,
      productType: result.member.productType || null,
      fulfillment: result.member.fba ? "FBA" : "OTHER",
      role: result.member.role,
      parentSku: result.member.parentSku,
      parentageLevel: relationship.parentageLevel,
      attributeParentSku: relationship.parentSku,
      relationshipType: relationship.relationshipType,
      variationTheme: relationship.variationTheme,
      relationshipAttributesAbsent: relationshipAttributesAbsent(
        descriptor.marketplaceId,
        result.payload.attributes,
      ),
      dimensionSignature,
      explicitStandalone: explicitStandalone(
        result,
        descriptor.marketplaceId,
      ),
    };
  };

  const observeDemo = (
    descriptor: VariationMoveDescriptor,
  ): VariationMoveObservation => {
    const family = dependencies.readDemoFamily(
      descriptor.marketplaceId,
      descriptor.sellerSku,
    );
    const member = family.queried;
    const override = demoOverrides.get(demoKey(
      descriptor.marketplaceId,
      descriptor.sellerSku,
    )) ?? null;
    const role = override?.role ?? member.role;
    const parentSku = override?.parentSku ?? member.parentSku;
    const variationTheme = override?.variationTheme ?? member.variationTheme;
    const relationshipAttributesAreAbsent = role === "standalone" &&
      parentSku === null;
    let dimensionSignature: string | null = null;
    if (descriptor.action === "attach" && override?.dimensionValues) {
      try {
        dimensionSignature = variationDimensionSignature({
          dimensionNames: [...descriptor.dimensionNames],
          dimensionValues: { ...override.dimensionValues },
          marketplaceId: descriptor.marketplaceId,
        });
      } catch {
        dimensionSignature = null;
      }
    }
    return {
      marketplaceId: descriptor.marketplaceId,
      sellerSku: member.sellerSku,
      asin: member.asin,
      productType: member.productType || null,
      fulfillment: member.fba ? "FBA" : "OTHER",
      role,
      parentSku,
      parentageLevel: relationshipAttributesAreAbsent ? null : "child",
      attributeParentSku: relationshipAttributesAreAbsent ? null : parentSku,
      relationshipType: role === "child" ? "variation" : null,
      variationTheme: role === "child" ? variationTheme : null,
      relationshipAttributesAbsent: relationshipAttributesAreAbsent,
      dimensionSignature,
      explicitStandalone: role === "standalone" && parentSku === null,
    };
  };

  const readCanonicalLive = async (identity: Readonly<{
    marketplaceId: MarketplaceId;
    sellerSku: string;
  }>): Promise<VariationMoveCanonicalObservation> => {
    const { item: result, family } = await readVariationItemAndFamily(
      dependencies.listings,
      identity,
    );
    const relationship = relationshipSnapshot(
      identity.marketplaceId,
      result.payload.attributes,
    );
    const canonicalParent = family.parent?.sellerSku === relationship.parentSku
      ? family.parent
      : null;
    let dimensionSignature: string | null = null;
    if (family.dimensionNames.length > 0) {
      try {
        dimensionSignature = variationDimensionSignature({
          dimensionNames: [...family.dimensionNames],
          dimensionValues: valuesForDimensions(
            result.payload.attributes,
            identity.marketplaceId,
            family.dimensionNames,
          ),
          marketplaceId: identity.marketplaceId,
        });
      } catch {
        dimensionSignature = null;
      }
    }
    return {
      mode: "live",
      attributeSignatures: variationAttributeSignatures(result.payload.attributes, identity.marketplaceId),
      exactAttributeSignatures: variationAttributeSignatures(result.payload.attributes, identity.marketplaceId, true),
      wholeAttributeSignatures: wholeVariationAttributeSignatures(result.payload.attributes),
      marketplaceId: identity.marketplaceId,
      sellerSku: result.member.sellerSku,
      asin: result.member.asin,
      productType: result.member.productType || null,
      fulfillment: result.member.fba ? "FBA" : "OTHER",
      role: result.member.role,
      parentSku: result.member.parentSku,
      parentageLevel: relationship.parentageLevel,
      attributeParentSku: relationship.parentSku,
      relationshipType: relationship.relationshipType,
      variationTheme: relationship.variationTheme,
      relationshipAttributesAbsent: relationshipAttributesAbsent(
        identity.marketplaceId,
        result.payload.attributes,
      ),
      dimensionNames: [...family.dimensionNames],
      dimensionSignature,
      explicitStandalone: explicitStandalone(result, identity.marketplaceId),
      familyComplete: family.familyComplete,
      parentAsin: canonicalParent?.asin ?? null,
      parentProductType: canonicalParent?.productType || null,
    };
  };

  const readCanonicalDemo = (identity: Readonly<{
    marketplaceId: MarketplaceId;
    sellerSku: string;
  }>): VariationMoveCanonicalObservation => {
    const family = dependencies.readDemoFamily(
      identity.marketplaceId,
      identity.sellerSku,
    );
    const member = family.queried;
    const override = demoOverrides.get(demoKey(
      identity.marketplaceId,
      identity.sellerSku,
    )) ?? null;
    const attributes = demoAttributes({
      member,
      marketplaceId: identity.marketplaceId,
      override,
    });
    const relationship = relationshipSnapshot(
      identity.marketplaceId,
      attributes,
    );
    const role = override?.role ?? member.role;
    const parentSku = override?.parentSku ?? member.parentSku;
    const canonicalParent = family.parent?.sellerSku === parentSku
      ? family.parent
      : null;
    let dimensionSignature: string | null = null;
    if (family.dimensionNames.length > 0) {
      try {
        dimensionSignature = variationDimensionSignature({
          dimensionNames: [...family.dimensionNames],
          dimensionValues: valuesForDimensions(
            attributes,
            identity.marketplaceId,
            family.dimensionNames,
          ),
          marketplaceId: identity.marketplaceId,
        });
      } catch {
        dimensionSignature = null;
      }
    }
    return {
      mode: "demo",
      marketplaceId: identity.marketplaceId,
      sellerSku: member.sellerSku,
      asin: member.asin,
      productType: member.productType || null,
      fulfillment: member.fba ? "FBA" : "OTHER",
      role,
      parentSku,
      parentageLevel: relationship.parentageLevel,
      attributeParentSku: relationship.parentSku,
      relationshipType: relationship.relationshipType,
      variationTheme: relationship.variationTheme,
      relationshipAttributesAbsent: relationshipAttributesAbsent(
        identity.marketplaceId,
        attributes,
      ),
      dimensionNames: [...family.dimensionNames],
      dimensionSignature,
      explicitStandalone: role === "standalone" && parentSku === null,
      familyComplete: family.familyComplete,
      parentAsin: canonicalParent?.asin ?? null,
      parentProductType: canonicalParent?.productType || null,
    };
  };

  return {
    mode: dependencies.resolveMode,
    readCanonical: async (identity) =>
      dependencies.resolveMode(identity.marketplaceId) === "demo"
        ? readCanonicalDemo(identity)
        : readCanonicalLive(identity),
    prepare: async (input) => {
      const generation = ensureGeneration();
      return dependencies.resolveMode(input.marketplaceId) === "demo"
        ? prepareDemo(input, generation)
        : prepareLive(input, generation);
    },
    observe: async (descriptor) =>
      dependencies.resolveMode(descriptor.marketplaceId) === "demo"
        ? observeDemo(descriptor)
        : observeLive(descriptor),
    validationPreview: async (descriptor) => {
      const reply = await dependencies.write.validationPreview({
        marketplaceId: descriptor.marketplaceId,
        sellerSku: descriptor.sellerSku,
        patchBody: patchBody(descriptor),
      });
      if (
        reply.ok &&
        (!isRecord(reply.payload) || reply.payload.sku !== descriptor.sellerSku)
      ) {
        throw new SpApiError(
          "Amazon 預檢回覆未確認同一個 Seller SKU，已停止此預檢，請重新讀取。",
          {
            status: 409,
            code: "LISTING_IDENTITY_MISMATCH",
            requestId: publicSpApiRequestId(reply.requestId),
            operation: "patchListingsItemPreview",
          },
        );
      }
      if (
        reply.ok &&
        isRecord(reply.payload) &&
        Object.hasOwn(reply.payload, "errors")
      ) {
        throw new SpApiError(
          "Amazon 預檢回覆格式不一致，請重新預檢；尚未送出任何變體關係。",
          {
            status: 502,
            code: "VALIDATION_PREVIEW_UNKNOWN",
            requestId: publicSpApiRequestId(reply.requestId),
            operation: "patchListingsItemPreview",
          },
        );
      }
      // Recheck the opaque source after the network await; stale account evidence
      // cannot mint either automatic requirements or selectable field candidates.
      const source = sourceRecordFor(descriptor);
      const existingReceipt = reply.ok ? validationReceipt(reply) : null;
      if (existingReceipt?.status === "UNKNOWN" &&
        !existingReceipt.issues.some((issue) => issue.severity === "ERROR")) {
        // A filtered issue cannot turn an unknown receipt into a diagnosed rejection.
        return existingReceipt;
      }
      const hints = resolveVariationPreviewRequirements({
        schema: source.requiredSchema,
        marketplaceId: descriptor.marketplaceId,
        sellerSku: descriptor.sellerSku,
        httpStatus: reply.status,
        payload: reply.payload,
      });
      if (hints.rejectionReason)
        throwRequiredFieldExplanation(reply, hints.rejectionReason, hints.rejectionDetail);
      if (
        (hints.requiredNames.length || hints.choiceNames.length) &&
        source.requiredIssueKey
      ) {
        const combined = [
          ...new Set([
            ...(source.requiredAutomaticNames ?? []),
            ...hints.requiredNames,
          ]),
        ].slice(0, 30);
        const activeNames = [
          ...new Set([...(source.requiredIssueNames ?? []), ...combined]),
        ];
        const context = {
          schema: source.requiredSchema,
          attributes: source.attributes,
          marketplaceId: descriptor.marketplaceId,
          action: descriptor.action,
          dimensionNames: descriptor.dimensionNames,
          targetParentSku: descriptor.targetParentSku,
          variationTheme: descriptor.variationTheme,
          proposedValues: descriptor.requiredValues,
          dimensionValues: descriptor.dimensionValues,
        };
        const fieldResolution = resolveVariationRequiredFields({
          ...context,
          issueRequiredNames: activeNames,
        });
        const requiredFields = fieldResolution.fields.filter(
          (field) =>
            !source.requiredIssueChoices?.includes(field.name) ||
            combined.includes(field.name),
        );
        const choiceResolution = resolveVariationRequiredFieldChoices(
          context,
          [
            ...new Set([
              ...(source.requiredIssueChoices ?? []),
              ...hints.choiceNames,
            ]),
          ].filter(
            (name) =>
              !combined.includes(name) &&
              !requiredFields.some((field) => field.name === name),
          ),
        );
        const requiredFieldChoices = choiceResolution.fields;
        const preservedRequiredFields = preservedRequiredFieldDescriptors({
          ...context, sellerSku: descriptor.sellerSku,
          singleMarketplaceScope: source.singleMarketplaceScope, issueRequiredNames: combined,
        });
        if (
          requiredFields.some((field) =>
            hints.requiredNames.includes(field.name),
          ) ||
          requiredFieldChoices.length || preservedRequiredFields.some((field) => hints.requiredNames.includes(field.name))
        ) {
          if (requiredIssueHints.size >= 50) requiredIssueHints.delete(requiredIssueHints.keys().next().value!);
          requiredIssueHints.set(source.requiredIssueKey, {
            names: combined,
            choices: requiredFieldChoices.map((field) => field.name),
            expiresAt: Date.now() + 10 * 60_000,
          });
          return {
            ...(reply.ok
              ? validationReceipt(reply)
              : {
                  status: "INVALID" as const,
                  requestId: publicSpApiRequestId(reply.requestId),
                  issues: [],
                }),
            requiredFields,
            requiredFieldChoices,
            preservedRequiredFields,
          };
        }
        const blockedReason = hints.requiredNames
          .map((name) => fieldResolution.blocked.get(name)).find(Boolean);
        if (blockedReason) throwRequiredFieldExplanation(reply, blockedReason);
        if (!hints.unresolvedReason) {
          const choiceBlock = hints.choiceNames
            .map((name) => choiceResolution.blocked.get(name)).find(Boolean);
          if (choiceBlock) throwRequiredFieldExplanation(reply, choiceBlock);
        }
      }
      if (hints.unresolvedReason)
        throwRequiredFieldExplanation(reply, hints.unresolvedReason);
      if (hints.requiredNames.length || hints.choiceNames.length)
        throwRequiredFieldExplanation(reply, "UNSUPPORTED");
      if (!reply.ok) return throwTransportError(reply, "read");
      return validationReceipt(reply);
    },
    commitOnce: async (descriptor, fence, recordDispatch) => {
      let reply: VariationMoveTransportReply;
      let dispatchEvidenceSaved = false;
      try {
        const body = patchBody(descriptor);
        const assertPreservedFactsCurrent = async () => {
          await fence.assertCurrent();
          if (!Object.keys(descriptor.preservedRequiredValues ?? {}).length) return;
          const source = sourceRecordFor(descriptor);
          const [current, schema, currentTarget] = await Promise.all([
            readVariationItem(dependencies.listings, descriptor),
            readChildSchema(dependencies.listings, descriptor.marketplaceId, descriptor.productType),
            descriptor.action === "attach" ? readVariationItemAndFamily(dependencies.listings, {
              marketplaceId: descriptor.marketplaceId, sellerSku: descriptor.targetParentSku,
            }) : Promise.resolve(null),
          ]);
          await fence.assertCurrent();
          sourceRecordFor(descriptor);
          if (currentTarget && !currentTarget.family.familyComplete) {
            throw new SpApiError("送出前重新讀取的目標 family 不完整，尚未送出修改；請重新讀取。", {
              status: 409, code: "VARIATION_FAMILY_INCOMPLETE",
            });
          }
          if (descriptor.action === "attach" && (!currentTarget ||
              currentTarget.item.member.sellerSku !== descriptor.targetParentSku ||
              currentTarget.item.member.asin !== descriptor.targetAsin ||
              currentTarget.item.member.productType !== descriptor.productType || currentTarget.item.member.role !== "parent" ||
              targetFamilySignature(currentTarget) !== descriptor.targetFamilySignature) ||
            current.member.asin !== descriptor.asin || current.member.productType !== descriptor.productType ||
            !current.member.fba || current.member.parentSku !== descriptor.expectedSourceParentSku ||
            current.member.role !== (descriptor.action === "detach" ? "child" : "standalone") ||
            descriptor.action === "attach" && !explicitStandalone(current, descriptor.marketplaceId) ||
            JSON.stringify(wholeVariationAttributeSignatures(current.payload.attributes)) !==
              JSON.stringify(wholeVariationAttributeSignatures(source.attributes)) ||
            requirementsChecksum(schema.schema, schema.checksum) !== source.requiredSchemaChecksum) {
            throw new SpApiError("保留的產品原值、商品身分或 PTD 在送出前已變更，尚未送出修改；請重新檢查。", {
              status: 409, code: "PREVIEW_CHANGED",
            });
          }
        };
        try {
          reply = await dependencies.write.commitOnce({
            marketplaceId: descriptor.marketplaceId,
            sellerSku: descriptor.sellerSku,
            patchBody: body,
            assertBeforeSend: assertPreservedFactsCurrent,
            recordBeforeSend: async () => {
              await recordDispatch();
              dispatchEvidenceSaved = true;
            },
          });
        } catch (error) {
          if (
            error instanceof SpApiPreCommitError ||
            (error instanceof SpApiError &&
              error.code === "UPDATE_STATUS_UNKNOWN")
          ) {
            throw error;
          }
          const cause = error instanceof SpApiError
            ? error
            : new SpApiError(
                "變體正式 PATCH 送出前的 Amazon transport 準備失敗。",
                {
                  status: 500,
                  code: "PRECOMMIT_FAILED",
                  operation: "patchListingsItem",
                },
              );
          throw new SpApiPreCommitError(cause);
        }
      } catch (error) {
        if (
          dispatchEvidenceSaved &&
          !(error instanceof SpApiPreCommitError) &&
          !(error instanceof SpApiError &&
            error.code === "UPDATE_STATUS_UNKNOWN")
        ) {
          throw new SpApiError(
            "Amazon 正式 PATCH 已進入送出邊界，但 transport 結果不明。系統已禁止重送。",
            {
              status: 503,
              code: "UPDATE_STATUS_UNKNOWN",
              operation: "patchListingsItem",
            },
          );
        }
        return preCommitTransportError(error);
      }
      if (!reply.ok) {
        try {
          return throwTransportError(reply, "write");
        } catch (error) {
          if (!dispatchEvidenceSaved || !(error instanceof SpApiError)) {
            throw error;
          }
          throw new SpApiError(
            `${error.message} Amazon 正式 PATCH 已送出，但結果無法由此 HTTP 回應安全確認；請先回查 SKU。`,
            {
              status: error.status,
              code: "UPDATE_STATUS_UNKNOWN",
              requestId: error.requestId,
              retryAfter: error.retryAfter,
              issues: [...error.issues],
              operation: error.operation,
              upstreamCode: error.upstreamCode,
            },
          );
        }
      }
      return commitReceipt(reply);
    },
    replaceDemoRelationship: async (descriptor, fence) => {
      const source = sourceRecordFor(descriptor);
      if (descriptor.action === "attach") {
        attachRecordsFor(descriptor, source);
      }
      await fence.assertCurrent();
      demoOverrides.set(demoKey(
        descriptor.marketplaceId,
        descriptor.sellerSku,
      ), descriptor.action === "detach"
        ? {
            role: "standalone",
            parentSku: null,
            variationTheme: null,
            dimensionValues: null,
          }
        : {
            role: "child",
            parentSku: descriptor.targetParentSku,
            variationTheme: descriptor.variationTheme,
            dimensionValues: structuredClone(descriptor.dimensionValues),
          });
    },
  };
}

function sameDimensionNames(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return a.length === b.length &&
    a.every((value, index) => value === b[index]);
}
