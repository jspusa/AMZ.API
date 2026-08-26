import { randomUUID } from "node:crypto";
import type { MarketplaceId } from "../../shared/marketplaces";
import type {
  VariationFamilyMember,
  VariationFamilySnapshot,
} from "./variation-family";
import {
  listingSubmissionIssuesAreWellFormed,
} from "./business-pricing-evidence";
import {
  readVariationFamily,
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
import { classifyUnboundVariationEvidence } from
  "./unbound-variation-audit";
import type { ListingWriteExecutionFence } from
  "./listing-write-execution-fence";
import {
  assertVariationDetached,
  buildVariationAttachBody,
  buildVariationDetachBody,
  variationDimensionSignature,
  variationFieldDescriptors,
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

type VariationMoveTransportReply = Readonly<{
  ok: boolean;
  status: number;
  requestId: string | null;
  retryAfter: string | null;
  payload: unknown;
}>;

export type VariationMoveGatewayProductionDependencies = Readonly<{
  listings: ListingsReadAdapter;
  resolveMode(marketplaceId: MarketplaceId): "live" | "demo";
  credentialGeneration(): number;
  readDemoFamily(
    marketplaceId: MarketplaceId,
    sellerSku: string,
  ): VariationFamilySnapshot;
  write(input: Readonly<{
    marketplaceId: MarketplaceId;
    sellerSku: string;
    body: VariationPatchBody;
    validationPreview: boolean;
    fence?: ListingWriteExecutionFence;
    recordBeforeSend?: () => Promise<void>;
  }>): Promise<VariationMoveTransportReply>;
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

type SourceEvidenceRecord = EvidenceBase & Readonly<{
  asin: string | null;
  productType: string | null;
  attributes: Record<string, unknown> | undefined;
}>;

type TargetEvidenceRecord = EvidenceBase & Readonly<{
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
    dimensionNames.map((name) => [
      name,
      (Array.isArray(attributes?.[name]) ? attributes[name] : [])
        .filter(isRecord)
        .filter((value) => {
          const itemMarketplace = typeof value.marketplace_id === "string"
            ? value.marketplace_id.trim()
            : "";
          return !itemMarketplace || itemMarketplace === marketplaceId;
        })
        .map((value) => structuredClone(value)),
    ]),
  );
}

function variationTargetParent(
  family: VariationFamilySnapshot,
): VariationFamilyMember {
  return family.queried.role === "parent"
    ? family.queried
    : family.parent ?? family.queried;
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

function explicitStandalone(
  result: VariationItemReadResult,
  marketplaceId: MarketplaceId,
): boolean {
  const evidence = classifyUnboundVariationEvidence({
    marketplaceId,
    profile: result.profile,
    relationships: result.payload.relationships,
    role: result.member.role,
    listingFulfillmentEvidence: result.member.fba ? "FBA" : "OTHER",
  });
  return evidence.kind === "unbound" &&
    result.member.role === "standalone" &&
    result.member.parentSku === null;
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

function validationReceipt(
  reply: VariationMoveTransportReply,
): VariationMoveValidationReceipt {
  const wellFormed = isRecord(reply.payload) &&
    listingSubmissionIssuesAreWellFormed(reply.payload.issues);
  const status = wellFormed &&
      (reply.payload.status === "VALID" || reply.payload.status === "INVALID")
    ? reply.payload.status
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
      ptd.checksum !== descriptor.childSchemaChecksum
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
      if (descriptor.action === "detach") {
        return buildVariationDetachBody({
          productType: descriptor.productType,
          marketplaceId: descriptor.marketplaceId,
          expectedParentSku: descriptor.expectedSourceParentSku,
          attributes: source.attributes,
        });
      }
      const records = attachRecordsFor(descriptor, source);
      variationFieldDescriptors({
        productTypeDefinition: records.ptd.schema,
        dimensionNames: [...descriptor.dimensionNames],
        attributes: source.attributes,
        marketplaceId: descriptor.marketplaceId,
      });
      return buildVariationAttachBody({
        productType: descriptor.productType,
        marketplaceId: descriptor.marketplaceId,
        targetParentSku: descriptor.targetParentSku,
        variationTheme: descriptor.variationTheme,
        dimensionNames: [...descriptor.dimensionNames],
        dimensionValues: { ...descriptor.dimensionValues },
        existingAttributes: source.attributes,
      });
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
      const capability = mintSource({
        ...base,
        asin: sourceResult.member.asin,
        productType: sourceResult.member.productType || null,
        attributes: sourceResult.payload.attributes,
      });
      return {
        action: "detach",
        mode: "live",
        source: liveSourceObservation({
          marketplaceId: input.marketplaceId,
          result: sourceResult,
          familyComplete: sourceFamily.familyComplete,
          sourceEvidence: capability,
        }),
        requestIds: [
          sourceResult.requestId,
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
    const capability = mintSource({
      ...base,
      asin: sourceResult.member.asin,
      productType: sourceResult.member.productType || null,
      attributes: sourceResult.payload.attributes,
    });
    const targetCapability = mintTarget({
      ...base,
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
    const source = liveSourceObservation({
      marketplaceId: input.marketplaceId,
      result: sourceResult,
      familyComplete: sourceFamily.familyComplete,
      sourceEvidence: capability,
    });
    const target: VariationMoveTargetObservation = {
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
      const reply = await dependencies.write({
        marketplaceId: descriptor.marketplaceId,
        sellerSku: descriptor.sellerSku,
        body: patchBody(descriptor),
        validationPreview: true,
      });
      if (!reply.ok) return throwTransportError(reply, "read");
      return validationReceipt(reply);
    },
    commitOnce: async (descriptor, fence, recordDispatch) => {
      let reply: VariationMoveTransportReply;
      let dispatchEvidenceSaved = false;
      try {
        const body = patchBody(descriptor);
        reply = await dependencies.write({
          marketplaceId: descriptor.marketplaceId,
          sellerSku: descriptor.sellerSku,
          body,
          validationPreview: false,
          fence,
          recordBeforeSend: async () => {
            await recordDispatch();
            dispatchEvidenceSaved = true;
          },
        });
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
