import {
  marketplaceByCode,
  marketplaceById,
  type MarketplaceId,
} from "../../shared/marketplaces";
import {
  listingSubmissionIssuesAreWellFormed,
} from "./business-pricing-evidence";
import type {
  ListingContentGateway,
  ListingContentGatewayRead,
  ListingContentIdentity,
  ListingContentPatchDescriptor,
  ListingContentPtdEvidence,
  ListingContentSourceEvidence,
  ListingContentValidationReceipt,
  ListingContentCommitReceipt,
} from "./listing-content-gateway";
import type { ListingContentReadProduction } from
  "./listing-content-read-production";
import type {
  ListingContentField,
  ListingContentFieldCapability,
  ListingContentSnapshot,
  ListingContentValues,
} from "./listing-content-types";
import {
  CONTENT_TEXT_ATTRIBUTE_NAMES,
  IMAGE_ATTRIBUTE_NAMES,
  canonicalSha256,
  isRecord,
  payloadHasFbaAvailability,
  type AmazonListingItem,
  type JsonRecord,
  type ListingContentAttributeName,
} from "./listing-item-projection";
import type { ListingPriceSnapshot } from "./listing-price-types";
import {
  normalizeListingIssues,
  throwListingsPayloadError,
} from "./listings-response-error";
import type {
  ListingsWriteProduction,
  ListingsWriteReceipt,
} from "./listings-write-production";
import { SpApiError } from "./sp-api-error";

const LISTING_CONTENT_FIELDS = [
  "title",
  "itemHighlight",
  "bulletPoints",
  "productDescription",
  "ingredients",
] as const satisfies readonly ListingContentField[];

const JP_MARKETPLACE_ID = marketplaceByCode("JP").id;

type ListingContentRawAttributes = Readonly<
  Record<ListingContentAttributeName, readonly JsonRecord[]>
>;

type ProductionListingContentSourceEvidence = Readonly<{
  nonce: object;
  mode: "live" | "demo";
  purpose: "read-only" | "mutation";
  generation: number;
  marketplaceId: MarketplaceId;
  sellerSku: string;
  asin: string | null;
  productType: string;
  languageTag: string;
  rawContentGuardHash: string;
  capabilityGuardHash: string;
  fbaEvidenceHash: string;
  rawAttributes: ListingContentRawAttributes;
  payload: AmazonListingItem;
}>;

type ProductionListingContentPtdEvidence = Readonly<{
  nonce: object;
  mode: "live" | "demo";
  purpose: "read-only" | "mutation";
  generation: number;
  marketplaceId: MarketplaceId;
  productType: string;
  schemaChecksum: string | null;
  capabilityGuardHash: string;
}>;

export type ListingContentGatewayProductionDependencies = Readonly<{
  contentReads: Pick<ListingContentReadProduction, "read">;
  readDemoListing(identity: ListingContentIdentity): ListingPriceSnapshot;
  resolveMode(marketplaceId: MarketplaceId): "live" | "demo";
  credentialGeneration(): number;
  write: ListingsWriteProduction;
}>;

export type ListingContentGatewayProductionRuntime = Readonly<{
  gateway: ListingContentGateway;
  clear(): void;
  readDemo(identity: ListingContentIdentity): ListingContentSnapshot;
}>;

function demoCapability(
  options: Partial<ListingContentFieldCapability> = {},
): ListingContentFieldCapability {
  return {
    supported: true,
    editable: true,
    required: false,
    minItems: 1,
    maxItems: 1,
    minLength: 1,
    maxLength: 500,
    maxUtf8Bytes: null,
    languageTags: [],
    reason: null,
    ...options,
  };
}

function demoListingKey(identity: ListingContentIdentity): string {
  return `${identity.marketplaceId}:${identity.sellerSku}`;
}

function listingContentRawAttributes(
  payload: AmazonListingItem,
): ListingContentRawAttributes {
  const entries = CONTENT_TEXT_ATTRIBUTE_NAMES.map((attributeName) => {
    const raw = payload.attributes?.[attributeName];
    if (raw === undefined) return [attributeName, []] as const;
    if (!Array.isArray(raw) || !raw.every(isRecord)) {
      throw new SpApiError(
        "Amazon 商品內容欄位不是可精確核對的 attribute 陣列，已停止使用。",
        { status: 409, code: "CONTENT_SELECTOR_UNSAFE" },
      );
    }
    return [
      attributeName,
      raw.map((item) => structuredClone(item)),
    ] as const;
  });
  return Object.fromEntries(entries) as ListingContentRawAttributes;
}

function listingContentCapabilityGuardHash(
  snapshot: ListingContentSnapshot,
): string {
  return canonicalSha256({
    schemaChecksum: snapshot.capabilities.schemaChecksum,
    title: snapshot.capabilities.title,
    itemHighlight: snapshot.capabilities.itemHighlight,
    bulletPoints: snapshot.capabilities.bulletPoints,
    productDescription: snapshot.capabilities.productDescription,
    ingredients: snapshot.capabilities.ingredients,
  });
}

function listingContentFbaEvidenceHash(payload: AmazonListingItem): string {
  const availability = payload.fulfillmentAvailability;
  if (
    !Array.isArray(availability) ||
    !availability.length ||
    !availability.every((entry) =>
      isRecord(entry) &&
      typeof entry.fulfillmentChannelCode === "string" &&
      Boolean(entry.fulfillmentChannelCode.trim()) &&
      entry.fulfillmentChannelCode === entry.fulfillmentChannelCode.trim() &&
      (entry.quantity === undefined ||
        (typeof entry.quantity === "number" &&
          Number.isFinite(entry.quantity) && entry.quantity >= 0))
    ) ||
    !payloadHasFbaAvailability(payload)
  ) {
    throw new SpApiError(
      "Amazon 商品內容回應缺少可精確核對的 FBA fulfillment evidence。",
      { status: 409, code: "FBA_ONLY" },
    );
  }
  return canonicalSha256(availability);
}

function demoListingContentPayload(
  snapshot: ListingContentSnapshot,
): AmazonListingItem {
  const value = (text: string) => ({
    value: text,
    language_tag: snapshot.languageTag,
    marketplace_id: snapshot.marketplaceId,
  });
  return {
    sku: snapshot.sellerSku,
    summaries: [{
      marketplaceId: snapshot.marketplaceId,
      asin: snapshot.asin ?? undefined,
      productType: snapshot.productType,
      status: [...snapshot.status],
      itemName: snapshot.title,
      createdDate: snapshot.createdAt ?? undefined,
      lastUpdatedDate: snapshot.updatedAt ?? undefined,
    }],
    productTypes: [{
      marketplaceId: snapshot.marketplaceId,
      productType: snapshot.productType,
    }],
    attributes: {
      item_name: [value(snapshot.title)],
      title_differentiation: [value(snapshot.itemHighlight)],
      bullet_point: snapshot.bulletPoints.map(value),
      product_description: [value(snapshot.productDescription)],
      ingredients: [value(snapshot.ingredients)],
    },
    fulfillmentAvailability: [{
      fulfillmentChannelCode: "AMAZON_DEMO",
      quantity: 1,
    }],
    issues: [],
  };
}

function validListingContentValues(value: ListingContentValues): boolean {
  return typeof value.title === "string" &&
    typeof value.itemHighlight === "string" &&
    Array.isArray(value.bulletPoints) &&
    value.bulletPoints.length <= 5 &&
    value.bulletPoints.every((bullet) => typeof bullet === "string") &&
    typeof value.productDescription === "string" &&
    typeof value.ingredients === "string";
}

function sameListingContentField(
  field: ListingContentField,
  left: ListingContentValues,
  right: ListingContentValues,
): boolean {
  if (field !== "bulletPoints") return left[field] === right[field];
  return left.bulletPoints.length === right.bulletPoints.length &&
    left.bulletPoints.every(
      (value, index) => value === right.bulletPoints[index],
    );
}

function exactListingContentChanges(
  patch: ListingContentPatchDescriptor,
): boolean {
  if (!validListingContentValues(patch.previous) ||
      !validListingContentValues(patch.requested)) return false;
  const expected = LISTING_CONTENT_FIELDS.filter((field) =>
    !sameListingContentField(field, patch.previous, patch.requested)
  );
  return expected.length > 0 &&
    expected.length === patch.changedFields.length &&
    expected.every((field, index) => patch.changedFields[index] === field);
}

function currentMarketplaceContentAttributes(
  evidence: ProductionListingContentSourceEvidence,
  attributeName: ListingContentAttributeName,
): readonly JsonRecord[] {
  return evidence.rawAttributes[attributeName].filter((item) => {
    const marketplaceId = item.marketplace_id;
    return typeof marketplaceId !== "string" ||
      !marketplaceId ||
      marketplaceId === evidence.marketplaceId;
  });
}

function listingContentPatchField(
  field: ListingContentField,
  requested: ListingContentValues,
): Readonly<{
  attributeName: ListingContentAttributeName;
  label: string;
  texts: readonly string[];
}> {
  if (field === "title") {
    return {
      attributeName: "item_name",
      label: "商品標題",
      texts: [requested.title],
    };
  }
  if (field === "itemHighlight") {
    return {
      attributeName: "title_differentiation",
      label: "產品亮點",
      texts: [requested.itemHighlight],
    };
  }
  if (field === "bulletPoints") {
    return {
      attributeName: "bullet_point",
      label: "五大賣點",
      texts: requested.bulletPoints,
    };
  }
  if (field === "productDescription") {
    return {
      attributeName: "product_description",
      label: "產品敘述",
      texts: [requested.productDescription],
    };
  }
  return {
    attributeName: "ingredients",
    label: "成分",
    texts: [requested.ingredients],
  };
}

function listingContentGatewayPatchBody(
  patch: ListingContentPatchDescriptor,
  evidence: ProductionListingContentSourceEvidence,
): Readonly<{ productType: string; patches: readonly unknown[] }> {
  const patches = patch.changedFields.map((field) => {
    const { attributeName, label, texts } = listingContentPatchField(
      field,
      patch.requested,
    );
    const existing = currentMarketplaceContentAttributes(
      evidence,
      attributeName,
    );
    if (
      existing.some((item) =>
        typeof item.language_tag !== "string" || !item.language_tag.trim()
      )
    ) {
      throw new SpApiError(
        `${label}的現有語系標記不完整，為避免覆蓋其他內容，請先到 Seller Central 檢查。`,
        { status: 422, code: "CONTENT_SELECTOR_UNSAFE" },
      );
    }
    const preservedLanguages = existing.filter(
      (item) => item.language_tag !== patch.languageTag,
    );
    return {
      op: existing.length ? "replace" : "add",
      path: `/attributes/${attributeName}`,
      value: [
        ...preservedLanguages,
        ...texts.map((text) => ({
          value: text,
          language_tag: patch.languageTag,
          marketplace_id: patch.marketplaceId,
        })),
      ],
    };
  });
  return { productType: patch.productType, patches };
}

function capturedListingContentPayload(
  receipt: ListingsWriteReceipt,
): JsonRecord | null {
  return isRecord(receipt.payload) ? receipt.payload : null;
}

function throwListingContentTransportError(
  receipt: ListingsWriteReceipt,
  operation: "read" | "write",
): never {
  return throwListingsPayloadError({
    status: receipt.status,
    operation,
    apiOperation: operation === "read"
      ? "patchListingsItemPreview"
      : "patchListingsItem",
    requestId: receipt.requestId,
    retryAfter: receipt.retryAfter,
    payload: capturedListingContentPayload(receipt),
  });
}

function safeListingSubmissionId(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/u.test(value);
}

function exactListingContentPreviewIdentity(
  payload: JsonRecord,
  patch: ListingContentPatchDescriptor,
): boolean {
  if (payload.sku !== patch.sellerSku ||
      !safeListingSubmissionId(payload.submissionId) ||
      !Array.isArray(payload.identifiers) || payload.identifiers.length !== 1) {
    return false;
  }
  const identifier = payload.identifiers[0];
  return isRecord(identifier) &&
    identifier.marketplaceId === patch.marketplaceId &&
    identifier.asin === patch.asin;
}

function listingContentValidationReceipt(
  receipt: ListingsWriteReceipt,
  patch: ListingContentPatchDescriptor,
  canonicalPatchHash: string,
): ListingContentValidationReceipt {
  const payload = capturedListingContentPayload(receipt);
  const wellFormed = payload !== null &&
    listingSubmissionIssuesAreWellFormed(payload.issues);
  const issues = wellFormed ? normalizeListingIssues(payload.issues) : [];
  let status: ListingContentValidationReceipt["status"] = "UNKNOWN";
  if (wellFormed && payload.status === "VALID" &&
      exactListingContentPreviewIdentity(payload, patch)) {
    status = "VALID";
  } else if (wellFormed && payload.status === "INVALID" &&
      payload.sku === patch.sellerSku) {
    status = "INVALID";
  }
  return {
    status,
    canonicalPatchHash,
    requestId: receipt.requestId,
    issues,
  };
}

function listingContentCommitReceipt(
  receipt: ListingsWriteReceipt,
  patch: ListingContentPatchDescriptor,
): ListingContentCommitReceipt {
  const payload = capturedListingContentPayload(receipt);
  const wellFormed = payload !== null &&
    listingSubmissionIssuesAreWellFormed(payload.issues);
  const issues = wellFormed ? normalizeListingIssues(payload.issues) : [];
  const hasError = issues.some((issue) => issue.severity === "ERROR");
  let status: ListingContentCommitReceipt["status"] = "UNKNOWN";
  if (receipt.ok && wellFormed && !hasError &&
      payload.status === "ACCEPTED" &&
      payload.sku === patch.sellerSku &&
      safeListingSubmissionId(payload.submissionId)) {
    status = "ACCEPTED";
  } else if (wellFormed && hasError &&
      [400, 413, 415, 422].includes(receipt.status) &&
      payload.status === "INVALID" &&
      payload.sku === patch.sellerSku) {
    status = "INVALID";
  }
  return {
    status,
    submissionId: safeListingSubmissionId(payload?.submissionId)
      ? payload.submissionId
      : null,
    requestId: receipt.requestId,
    issues,
  };
}

export function createListingContentGatewayProduction(
  dependencies: ListingContentGatewayProductionDependencies,
): ListingContentGatewayProductionRuntime {
  const demoContentOverrides = new Map<string, ListingContentValues>();
  const listingContentSourceEvidence = new WeakMap<
    object,
    ProductionListingContentSourceEvidence
  >();
  const listingContentPtdEvidence = new WeakMap<
    object,
    ProductionListingContentPtdEvidence
  >();

  function readDemo(identity: ListingContentIdentity): ListingContentSnapshot {
    const listing = dependencies.readDemoListing(identity);
    const isJapan = identity.marketplaceId === JP_MARKETPLACE_ID;
    const base: ListingContentValues = {
      title: listing.title,
      itemHighlight: isJapan
        ? "単一原料で仕上げた、噛みごたえのある毎日のおやつ。"
        : "Single-ingredient, naturally chewy rewards for everyday treating.",
      bulletPoints: isJapan
        ? [
            "厳選した単一原料を使用した、シンプルでおいしい犬用おやつです。",
            "噛みごたえのある食感で、毎日のごほうびに適しています。",
            "人工着色料・人工香料を使用していません。",
            "小分けしやすく、トレーニングにも便利です。",
            "品質管理された施設で丁寧に製造しています。",
          ]
        : [
            "Single-ingredient dog treats made with carefully selected cuts.",
            "Naturally chewy texture for a satisfying everyday reward.",
            "No artificial colors or artificial flavors.",
            "Easy to portion for training, walks, and enrichment.",
            "Prepared in a quality-controlled facility.",
          ],
      productDescription: isJapan
        ? "厳選した七面鳥の腱を使用し、素材本来の風味と噛みごたえを大切に仕上げた犬用おやつです。毎日のごほうびやトレーニングに合わせて与える量を調整してください。"
        : "A simple dog treat made from carefully selected turkey tendon. The naturally chewy texture makes it suitable for everyday rewards, training, walks, and enrichment. Portion appropriately for your dog's size and supervise while treating.",
      ingredients: isJapan ? "七面鳥腱。" : "Turkey tendon.",
    };
    const content = demoContentOverrides.get(demoListingKey(identity)) ?? base;
    const marketplace = marketplaceById(identity.marketplaceId)!;
    const languageTag = marketplace.locale.replace("-", "_");
    return {
      mode: "demo",
      marketplaceId: identity.marketplaceId,
      sellerSku: identity.sellerSku,
      asin: listing.asin,
      productType: listing.productType,
      status: listing.status,
      title: content.title,
      itemHighlight: content.itemHighlight,
      bulletPoints: content.bulletPoints,
      productDescription: content.productDescription,
      ingredients: content.ingredients,
      languageTag,
      attributePresence: {
        title: true,
        itemHighlight: true,
        bulletPoints: true,
        productDescription: true,
        ingredients: true,
      },
      capabilities: {
        title: demoCapability({ maxLength: 75, languageTags: [languageTag] }),
        itemHighlight: demoCapability({
          maxLength: 125,
          languageTags: [languageTag],
        }),
        bulletPoints: demoCapability({
          minItems: 1,
          maxItems: 5,
          maxLength: 500,
          languageTags: [languageTag],
        }),
        productDescription: demoCapability({
          maxLength: 10_000,
          languageTags: [languageTag],
        }),
        ingredients: demoCapability({
          maxLength: 5_000,
          languageTags: [languageTag],
        }),
        images: IMAGE_ATTRIBUTE_NAMES.map((attributeName, index) => ({
          attributeName,
          label: index === 0 ? "主圖" : `副圖 ${index}`,
          supported: true,
          editable: true,
          required: index === 0,
          reason: null,
        })),
        schemaChecksum: "demo-schema",
      },
      createdAt: listing.createdAt,
      updatedAt: listing.updatedAt,
      fetchedAt: new Date().toISOString(),
      requestId: null,
      issues: listing.issues,
      notice: "展示內容只供操作測試，不會變更 Amazon。",
    };
  }

  function mintListingContentSourceEvidence(
    evidence: ProductionListingContentSourceEvidence,
  ): ListingContentSourceEvidence {
    const token = Object.freeze(Object.create(null)) as object;
    listingContentSourceEvidence.set(token, evidence);
    return token as ListingContentSourceEvidence;
  }

  function mintListingContentPtdEvidence(
    evidence: ProductionListingContentPtdEvidence,
  ): ListingContentPtdEvidence {
    const token = Object.freeze(Object.create(null)) as object;
    listingContentPtdEvidence.set(token, evidence);
    return token as ListingContentPtdEvidence;
  }

  function listingContentGatewayObservation(
    snapshot: ListingContentSnapshot,
    payload: AmazonListingItem,
    purpose: "read-only" | "mutation",
  ): ListingContentGatewayRead {
    const capturedPayload = structuredClone(payload);
    const rawAttributes = listingContentRawAttributes(capturedPayload);
    const rawContentGuardHash = canonicalSha256(rawAttributes);
    const capabilityGuardHash = listingContentCapabilityGuardHash(snapshot);
    const fbaEvidenceHash = listingContentFbaEvidenceHash(capturedPayload);
    const nonce = Object.freeze(Object.create(null)) as object;
    const generation = dependencies.credentialGeneration();
    const sourceEvidence = mintListingContentSourceEvidence({
      nonce,
      mode: snapshot.mode,
      purpose,
      generation,
      marketplaceId: snapshot.marketplaceId,
      sellerSku: snapshot.sellerSku,
      asin: snapshot.asin,
      productType: snapshot.productType,
      languageTag: snapshot.languageTag,
      rawContentGuardHash,
      capabilityGuardHash,
      fbaEvidenceHash,
      rawAttributes,
      payload: capturedPayload,
    });
    const ptdEvidence = mintListingContentPtdEvidence({
      nonce,
      mode: snapshot.mode,
      purpose,
      generation,
      marketplaceId: snapshot.marketplaceId,
      productType: snapshot.productType,
      schemaChecksum: snapshot.capabilities.schemaChecksum,
      capabilityGuardHash,
    });
    return {
      snapshot,
      fulfillment: "FBA",
      rawContentGuardHash,
      capabilityGuardHash,
      fbaEvidenceHash,
      sourceEvidence,
      ptdEvidence,
    };
  }

  function resolveListingContentEvidence(
    patch: ListingContentPatchDescriptor,
    expectedMode: "live" | "demo",
  ): Readonly<{
    source: ProductionListingContentSourceEvidence;
    ptd: ProductionListingContentPtdEvidence;
  }> {
    const source = listingContentSourceEvidence.get(
      patch.sourceEvidence as object,
    );
    const ptd = listingContentPtdEvidence.get(patch.ptdEvidence as object);
    if (
      (source && source.generation !== dependencies.credentialGeneration()) ||
      (ptd && ptd.generation !== dependencies.credentialGeneration())
    ) {
      throw new SpApiError(
        "Amazon 執行環境已在商品內容操作期間改變；舊證據已丟棄。",
        { status: 409, code: "CREDENTIALS_CHANGED" },
      );
    }
    if (
      !source ||
      !ptd ||
      source.nonce !== ptd.nonce ||
      source.purpose !== "mutation" ||
      ptd.purpose !== "mutation" ||
      source.mode !== expectedMode ||
      ptd.mode !== expectedMode ||
      source.marketplaceId !== patch.marketplaceId ||
      ptd.marketplaceId !== patch.marketplaceId ||
      source.sellerSku !== patch.sellerSku ||
      source.asin !== patch.asin ||
      !/^[A-Z0-9]{10}$/u.test(patch.asin) ||
      source.productType !== patch.productType ||
      ptd.productType !== patch.productType ||
      !patch.productType ||
      patch.productType !== patch.productType.trim() ||
      patch.productType.toUpperCase() === "PRODUCT" ||
      source.languageTag !== patch.languageTag ||
      !patch.languageTag ||
      ptd.schemaChecksum !== patch.schemaChecksum ||
      !patch.schemaChecksum ||
      source.capabilityGuardHash !== ptd.capabilityGuardHash ||
      source.rawContentGuardHash !== canonicalSha256(source.rawAttributes) ||
      source.fbaEvidenceHash !== listingContentFbaEvidenceHash(source.payload) ||
      patch.expectedOldHash !== canonicalSha256(patch.previous) ||
      !exactListingContentChanges(patch)
    ) {
      throw new SpApiError(
        "商品內容來源或 seller-specific PTD 證據已失效，或與這次 SKU／內容變更不一致，請重新預檢。",
        { status: 409, code: "LISTING_CONTENT_EVIDENCE_INVALID" },
      );
    }
    return { source, ptd };
  }

  function prepareListingContentGatewayPatch(
    patch: ListingContentPatchDescriptor,
    expectedMode: "live" | "demo",
    phase: "preview" | "commit",
  ): Readonly<{
    evidence: ProductionListingContentSourceEvidence;
    body: Readonly<{ productType: string; patches: readonly unknown[] }>;
    canonicalPatchHash: string;
  }> {
    const { source } = resolveListingContentEvidence(patch, expectedMode);
    const body = listingContentGatewayPatchBody(patch, source);
    const canonicalPatchHash = canonicalSha256(body);
    const expectedHash = patch.expectedCanonicalPatchHash;
    if (
      (phase === "preview" && expectedHash !== null) ||
      (phase === "commit" &&
        (typeof expectedHash !== "string" ||
          !/^[a-f0-9]{64}$/u.test(expectedHash) ||
          expectedHash !== canonicalPatchHash))
    ) {
      throw new SpApiError(
        "商品內容 canonical PATCH 已在預檢後改變，已停止送出。",
        { status: 409, code: "CONTENT_CHANGED" },
      );
    }
    return { evidence: source, body, canonicalPatchHash };
  }

  const gateway: ListingContentGateway = {
    mode: dependencies.resolveMode,
    read: async (identity, purpose) => {
      if (dependencies.resolveMode(identity.marketplaceId) === "demo") {
        const snapshot = readDemo(identity);
        return listingContentGatewayObservation(
          snapshot,
          demoListingContentPayload(snapshot),
          purpose,
        );
      }
      const context = await dependencies.contentReads.read({
        marketplaceId: identity.marketplaceId,
        sellerSku: identity.sellerSku,
        allowReadOnlySchema: purpose === "read-only",
        forceCapabilityRefresh: purpose === "mutation",
      });
      return listingContentGatewayObservation(
        context.listing,
        context.payload,
        purpose,
      );
    },
    validationPreview: async (patch) => {
      const mode = dependencies.resolveMode(patch.marketplaceId);
      const prepared = prepareListingContentGatewayPatch(
        patch,
        mode,
        "preview",
      );
      if (mode === "demo") {
        return {
          status: "VALID",
          canonicalPatchHash: prepared.canonicalPatchHash,
          requestId: null,
          issues: [],
        };
      }
      const receipt = await dependencies.write.validationPreview({
        marketplaceId: patch.marketplaceId,
        sellerSku: patch.sellerSku,
        patchBody: prepared.body,
        includeIdentifiers: true,
      });
      if (!receipt.ok) {
        return throwListingContentTransportError(receipt, "read");
      }
      return listingContentValidationReceipt(
        receipt,
        patch,
        prepared.canonicalPatchHash,
      );
    },
    commitOnce: async (patch, fence, recordDispatch) => {
      const prepared = prepareListingContentGatewayPatch(
        patch,
        "live",
        "commit",
      );
      const receipt = await dependencies.write.commitOnce({
        marketplaceId: patch.marketplaceId,
        sellerSku: patch.sellerSku,
        patchBody: prepared.body,
        assertBeforeSend: () => fence.assertCurrent(),
        recordBeforeSend: recordDispatch,
      });
      return listingContentCommitReceipt(receipt, patch);
    },
    replaceDemoContent: async (patch, fence) => {
      const prepared = prepareListingContentGatewayPatch(
        patch,
        "demo",
        "commit",
      );
      await fence.assertCurrent();
      if (
        prepared.evidence.generation !== dependencies.credentialGeneration()
      ) {
        throw new SpApiError(
          "Amazon 執行環境已在展示商品內容更新期間改變；舊結果已丟棄。",
          { status: 409, code: "CREDENTIALS_CHANGED" },
        );
      }
      demoContentOverrides.set(demoListingKey(patch), {
        title: patch.requested.title,
        itemHighlight: patch.requested.itemHighlight,
        bulletPoints: [...patch.requested.bulletPoints],
        productDescription: patch.requested.productDescription,
        ingredients: patch.requested.ingredients,
      });
    },
  };

  return Object.freeze({
    gateway: Object.freeze(gateway),
    clear() {
      demoContentOverrides.clear();
    },
    readDemo,
  });
}
