import { throwIfAborted } from "../abort-utils";
import type { MarketplaceId } from "../../shared/marketplaces";
import {
  APLUS_AUDIT_MAX_PUBLIC_COUNT,
  APLUS_AUDIT_MAX_PUBLIC_LOCALES_PER_ASIN,
  isAplusLanguageTag,
} from "../../shared/a-plus";
import {
  SpExecutionContextError,
  type SpExecutionContext,
  type SpExecutionContextAdapter,
  type SpExecutionMode,
} from "./sp-execution-context";

export type AplusAuditStatus =
  | "published"
  | "missing"
  | "incomplete"
  | "unavailable";

export type AplusAuditReasonCode =
  | "PUBLISHED_RECORD_FOUND"
  | "PUBLISHED_DOCUMENT_RELATION_FOUND"
  | "NO_PUBLISHED_RECORD"
  | "FBA_IDENTITY_INCOMPLETE"
  | "FBA_RELATIONSHIP_INCOMPLETE"
  | "A_PLUS_ACCESS_UNAVAILABLE"
  | "A_PLUS_READ_FAILED"
  | "A_PLUS_WARNING_PRESENT"
  | "A_PLUS_RESPONSE_INVALID"
  | "A_PLUS_PAGINATION_INCOMPLETE";

export type AplusAuditSeed = Readonly<{
  sellerSku: string;
  asin: string | null;
  title: string;
  incompleteReasonCode?: "FBA_RELATIONSHIP_INCOMPLETE";
}>;

export type AplusFbaGroupingSeed = Readonly<{
  sellerSku: string;
  asin: string;
  title: string;
  role: "parent" | "child" | "standalone" | "unknown";
  status: "complete" | "incomplete";
}>;

/**
 * Converts the strict Listings relationships result into the only seed shape
 * allowed to reach the A+ reader. Proven parent containers are not auditable
 * rows. An exact ASIN from the FBA all-listings scope remains available to the
 * account-wide document-relation index when variation relationships are
 * incomplete, but the incomplete marker prevents a per-ASIN publish request.
 */
export function buildAplusAuditSeedsFromFbaGrouping(
  rows: readonly AplusFbaGroupingSeed[],
): AplusAuditSeed[] {
  return rows.flatMap((row): AplusAuditSeed[] => {
    if (row.status === "complete" && row.role === "parent") return [];
    if (/^[A-Z0-9]{10}$/u.test(row.asin)) {
      const relationshipProven = row.status === "complete" &&
        (row.role === "child" || row.role === "standalone");
      return [{
        sellerSku: row.sellerSku,
        asin: row.asin,
        title: row.title,
        ...(relationshipProven
          ? {}
          : { incompleteReasonCode: "FBA_RELATIONSHIP_INCOMPLETE" as const }),
      }];
    }
    return [{
      sellerSku: row.sellerSku,
      asin: null,
      title: row.title,
      incompleteReasonCode: "FBA_RELATIONSHIP_INCOMPLETE" as const,
    }];
  });
}

type AplusPublishRecordFetchInput = Readonly<{
  marketplaceId: string;
  asin: string;
  pageToken?: string;
  signal?: AbortSignal;
}>;

type AplusPublishRecordFetchResult = Readonly<{
  status: number;
  payload: unknown;
  requestId?: string | null;
}>;

type AplusPublishRecordFetcher = (
  input: AplusPublishRecordFetchInput,
) => Promise<AplusPublishRecordFetchResult>;

type AplusContentDocumentFetchInput = Readonly<{
  marketplaceId: string;
  pageToken?: string;
  signal?: AbortSignal;
}>;

type AplusContentDocumentRelationFetchInput = Readonly<{
  marketplaceId: string;
  contentReferenceKey: string;
  pageToken?: string;
  signal?: AbortSignal;
}>;

type AplusContentDocumentFetcher = (
  input: AplusContentDocumentFetchInput,
) => Promise<AplusPublishRecordFetchResult>;

type AplusContentDocumentRelationFetcher = (
  input: AplusContentDocumentRelationFetchInput,
) => Promise<AplusPublishRecordFetchResult>;

export type AplusAuditProgress = Readonly<{
  completedAsins: number;
  totalAsins: number;
}>;

export type AplusDocumentStatus =
  | "APPROVED"
  | "DRAFT"
  | "REJECTED"
  | "SUBMITTED";

export type AplusDocumentBadge =
  | "BULK"
  | "GENERATED"
  | "LAUNCHPAD"
  | "PREMIUM"
  | "STANDARD";

export type AplusDocumentEvidence = Readonly<{
  name: string | null;
  documentStatus: AplusDocumentStatus | null;
  badges: readonly AplusDocumentBadge[];
  relationState: "published" | "not_published" | "related";
  evidence: "publish_record" | "relation_badge" | "relation_only";
  completeness: "complete" | "partial";
}>;

export type AplusAuditRow = Readonly<{
  sellerSku: string;
  asin: string | null;
  title: string;
  marketplaceId: string;
  status: AplusAuditStatus;
  sourceCompleteness: "complete" | "partial";
  publishedRecordCount: number | null;
  contentTypes: readonly ("EBC" | "EMC")[];
  locales: readonly string[];
  documents: readonly AplusDocumentEvidence[];
  documentEvidenceCompleteness: "complete" | "partial" | "unavailable";
  reasonCode: AplusAuditReasonCode;
  reason: string;
}>;

export type AplusAuditSnapshot = Readonly<{
  mode: "live" | "demo";
  marketplaceId: string;
  fetchedAt: string;
  fbaSnapshotId: string;
  totals: Readonly<{
    eligibleFbaSkus: number;
    uniqueAsins: number;
    published: number;
    missing: number;
    incomplete: number;
    unavailable: number;
  }>;
  summary: Readonly<{
    eligibleFbaSkus: number;
    uniqueAsins: number;
    published: number;
    missing: number;
    incomplete: number;
    unavailable: number;
  }>;
  rows: readonly AplusAuditRow[];
  notice: string;
}>;

type AsinResult = Omit<
  AplusAuditRow,
  | "sellerSku"
  | "title"
  | "asin"
  | "marketplaceId"
  | "documents"
  | "documentEvidenceCompleteness"
>;

type AsinReadResult = Readonly<{
  outcome: AsinResult;
  contentReferenceKeys: readonly string[];
}>;

type AplusDocumentRecord = Readonly<{
  contentReferenceKey: string;
  name: string;
  documentStatus: AplusDocumentStatus;
  badges: readonly AplusDocumentBadge[];
  updateTime: string;
  metadataCompleteness: "complete" | "partial";
}>;

type AplusDocumentRelation = Readonly<{
  contentReferenceKey: string;
  state: "published" | "not_published" | "related";
  completeness: "complete" | "partial";
}>;

type AplusDocumentIndex = Readonly<{
  documentsByKey: ReadonlyMap<string, AplusDocumentRecord>;
  relationsByAsin: ReadonlyMap<string, readonly AplusDocumentRelation[]>;
  conflictAsins: ReadonlySet<string>;
  partialAsins: ReadonlySet<string>;
  completeness: "complete" | "partial" | "unavailable";
}>;

const APLUS_DOCUMENT_STATUSES = new Set<AplusDocumentStatus>([
  "APPROVED",
  "DRAFT",
  "REJECTED",
  "SUBMITTED",
]);

const APLUS_DOCUMENT_BADGES = new Set<AplusDocumentBadge>([
  "BULK",
  "GENERATED",
  "LAUNCHPAD",
  "PREMIUM",
  "STANDARD",
]);

const APLUS_ASIN_BADGES = new Set([
  "BRAND_NOT_ELIGIBLE",
  "CATALOG_NOT_FOUND",
  "CONTENT_NOT_PUBLISHED",
  "CONTENT_PUBLISHED",
]);

const APLUS_MAX_DOCUMENTS_PER_ASIN = 100;
const APLUS_MAX_PAGE_REQUESTS = APLUS_AUDIT_MAX_PUBLIC_COUNT;
const APLUS_MAX_RELATION_EDGES = APLUS_AUDIT_MAX_PUBLIC_COUNT;

type AplusPageBudget = { remaining: number };

function claimAplusPage(budget: AplusPageBudget): boolean {
  if (budget.remaining <= 0) return false;
  budget.remaining -= 1;
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function throwIfAuditAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("A+ 健檢背景工作已中止。");
  error.name = "AbortError";
  throw error;
}

function throwIfAuditFence(error: unknown): void {
  if (error instanceof SpExecutionContextError) throw error;
  if (error instanceof Error && error.name === "AbortError") throw error;
}

function isExactText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/u.test(value)
  );
}

function isDisplayText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length <= maximum &&
    !value.includes("\u0000")
  );
}

function normalizedSeeds(input: Readonly<{
  mode: "live" | "demo";
  marketplaceId: string;
  fetchedAt: string;
  fbaSnapshotId: string;
  rows: readonly AplusAuditSeed[];
}>): AplusAuditSeed[] {
  if (input.mode !== "live" && input.mode !== "demo") {
    throw new Error("A+ 健檢模式無效。");
  }
  if (
    !isExactText(input.marketplaceId, 32) ||
    !/^[A-Z0-9]{10,24}$/u.test(input.marketplaceId)
  ) {
    throw new Error("A+ 健檢站點身分無法安全辨識。");
  }
  if (
    !isExactText(input.fetchedAt, 40) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(input.fetchedAt) ||
    !Number.isFinite(Date.parse(input.fetchedAt))
  ) {
    throw new Error("A+ 健檢快照時間無效。");
  }
  if (!isExactText(input.fbaSnapshotId, 256) || input.fbaSnapshotId.length < 8) {
    throw new Error("A+ 健檢缺少可核對的 FBA 快照身分。");
  }
  if (
    !Array.isArray(input.rows) ||
    input.rows.length > APLUS_AUDIT_MAX_PUBLIC_COUNT
  ) {
    throw new Error("A+ 健檢 FBA 商品範圍無效。");
  }
  const seenSellerSkus = new Set<string>();
  return input.rows.map((row) => {
    if (!isRecord(row) || !isExactText(row.sellerSku, 40)) {
      throw new Error("A+ 健檢 Seller SKU 無法安全辨識。");
    }
    if (seenSellerSkus.has(row.sellerSku)) {
      throw new Error("A+ 健檢含有重複 Seller SKU；已停止整次掃描。");
    }
    seenSellerSkus.add(row.sellerSku);
    if (!isDisplayText(row.title, 2_000)) {
      throw new Error(`A+ 健檢 ${row.sellerSku} 的商品名稱無法安全顯示。`);
    }
    const asin = typeof row.asin === "string" && /^[A-Z0-9]{10}$/u.test(row.asin)
      ? row.asin
      : null;
    const incompleteReasonCode = row.incompleteReasonCode;
    if (
      incompleteReasonCode !== undefined &&
      incompleteReasonCode !== "FBA_RELATIONSHIP_INCOMPLETE"
    ) {
      throw new Error("A+ 健檢 relationship incomplete seed 無效。");
    }
    return { sellerSku: row.sellerSku, asin, title: row.title, incompleteReasonCode };
  });
}

function isPublishRecord(
  value: unknown,
  marketplaceId: string,
  asin: string,
): value is Record<string, unknown> & {
  contentReferenceKey: string;
  contentType: "EBC" | "EMC";
  locale: string;
} {
  if (!isRecord(value)) return false;
  return (
    value.marketplaceId === marketplaceId &&
    value.asin === asin &&
    isExactText(value.contentReferenceKey, 2_048) &&
    (value.contentType === "EBC" || value.contentType === "EMC") &&
    isExactText(value.locale, 64) &&
    isAplusLanguageTag(value.locale) &&
    (
      value.contentSubType === undefined ||
      value.contentSubType === null ||
      isExactText(value.contentSubType, 256)
    )
  );
}

function warningEnvelopeState(
  value: unknown,
): "none" | "present" | "invalid" {
  if (value === undefined) return "none";
  if (!Array.isArray(value) || value.length > 1_000) return "invalid";
  if (value.length === 0) return "none";
  const valid = value.every((candidate) => {
    if (!isRecord(candidate)) return false;
    if (
      !isExactText(candidate.code, 256) ||
      !isDisplayText(candidate.message, 4_000) ||
      candidate.message.length === 0
    ) {
      return false;
    }
    return candidate.details === undefined || (
      isDisplayText(candidate.details, 8_000) && candidate.details.length > 0
    );
  });
  return valid ? "present" : "invalid";
}

function parsePublishRecordPage(
  marketplaceId: string,
  asin: string,
  payload: unknown,
): AsinResult {
  if (
    !isRecord(payload) ||
    !Array.isArray(payload.publishRecordList) ||
    payload.publishRecordList.length > 10_000
  ) {
    return {
      status: "incomplete",
      sourceCompleteness: "partial",
      publishedRecordCount: null,
      contentTypes: [],
      locales: [],
      reasonCode: "A_PLUS_RESPONSE_INVALID",
      reason: "Amazon A+ publish-record 回應格式不完整，不能判定是否已發布。",
    };
  }
  const records = payload.publishRecordList.filter((candidate) =>
    isPublishRecord(candidate, marketplaceId, asin)
  );
  const hasInvalidRecord = records.length !== payload.publishRecordList.length;
  const warningState = warningEnvelopeState(payload.warnings);
  if (records.length > 0) {
    const sourceIsPartial = hasInvalidRecord || warningState !== "none";
    return {
      status: "published",
      sourceCompleteness: sourceIsPartial ? "partial" : "complete",
      publishedRecordCount: sourceIsPartial ? null : records.length,
      contentTypes: [...new Set(records.map((record) => record.contentType as "EBC" | "EMC"))],
      locales: [...new Set(records.map((record) => String(record.locale)))],
      reasonCode: "PUBLISHED_RECORD_FOUND",
      reason: "Amazon publish record 已證明目前 ASIN 有已發布 A+。",
    };
  }
  if (hasInvalidRecord || warningState === "invalid") {
    return {
      status: "incomplete",
      sourceCompleteness: "partial",
      publishedRecordCount: null,
      contentTypes: [],
      locales: [],
      reasonCode: "A_PLUS_RESPONSE_INVALID",
      reason: "Amazon A+ publish-record 回應格式不完整，不能判定是否已發布。",
    };
  }
  if (warningState === "present") {
    return {
      status: "incomplete",
      sourceCompleteness: "partial",
      publishedRecordCount: null,
      contentTypes: [],
      locales: [],
      reasonCode: "A_PLUS_WARNING_PRESENT",
      reason: "Amazon A+ 回應含警告，無法確認目前是否已發布。",
    };
  }
  return {
    status: "missing",
    sourceCompleteness: "complete",
    publishedRecordCount: 0,
    contentTypes: [],
    locales: [],
    reasonCode: "NO_PUBLISHED_RECORD",
    reason: "Amazon 完整查詢沒有找到目前 ASIN 的已發布 A+。",
  };
}

function readFailure(status: number): AsinResult {
  return {
    status: status === 403 ? "unavailable" : "incomplete",
    sourceCompleteness: "partial",
    publishedRecordCount: null,
    contentTypes: [],
    locales: [],
    reasonCode: status === 403
      ? "A_PLUS_ACCESS_UNAVAILABLE"
      : "A_PLUS_READ_FAILED",
    reason: status === 403
      ? "A+ API 尚未取得讀取權限。"
      : "Amazon A+ publish-record 查詢未完成，不能判定是否已發布。",
  };
}

function relationshipIncompleteRead(): AsinReadResult {
  return {
    outcome: {
      status: "incomplete",
      sourceCompleteness: "partial",
      publishedRecordCount: null,
      contentTypes: [],
      locales: [],
      reasonCode: "FBA_RELATIONSHIP_INCOMPLETE",
      reason:
        "Amazon variation relationships 未完整證明此 FBA 商品為 child 或 standalone；未發出逐 ASIN publish-record request，只核對 account-wide A+ 文件關聯。",
    },
    contentReferenceKeys: [],
  };
}

function partialEvidenceResult(
  publishedRecordCount: number,
  contentTypes: ReadonlySet<"EBC" | "EMC">,
  locales: ReadonlySet<string>,
  fallback: AsinResult,
): AsinResult {
  if (publishedRecordCount === 0) return fallback;
  return {
    status: "published",
    sourceCompleteness: "partial",
    publishedRecordCount: null,
    contentTypes: [...contentTypes].sort((left, right) => left.localeCompare(right)),
    locales: [...locales].sort((left, right) => left.localeCompare(right)),
    reasonCode: "PUBLISHED_RECORD_FOUND",
    reason: "Amazon exact publish record 已證明目前 ASIN 有 A+；後續資料未完成，因此不顯示完整筆數。",
  };
}

function paginationFailure(): AsinResult {
  return {
    status: "incomplete",
    sourceCompleteness: "partial",
    publishedRecordCount: null,
    contentTypes: [],
    locales: [],
    reasonCode: "A_PLUS_PAGINATION_INCOMPLETE",
    reason: "Amazon A+ publish-record 分頁未正常結束，不能判定是否已發布。",
  };
}

function aplusPageToken(value: unknown): string | null | "invalid" {
  if (value === undefined || value === null) return null;
  return isExactText(value, 2_048) ? value : "invalid";
}

function parseDocumentRecord(
  value: unknown,
  marketplaceId: string,
): AplusDocumentRecord | null {
  if (!isRecord(value) || !isExactText(value.contentReferenceKey, 2_048)) {
    return null;
  }
  const metadata = value.contentMetadata;
  if (!isRecord(metadata)) return null;
  if (
    !isExactText(metadata.name, 100) ||
    metadata.marketplaceId !== marketplaceId ||
    typeof metadata.status !== "string" ||
    !APLUS_DOCUMENT_STATUSES.has(metadata.status as AplusDocumentStatus) ||
    !Array.isArray(metadata.badgeSet) ||
    metadata.badgeSet.length > APLUS_DOCUMENT_BADGES.size ||
    new Set(metadata.badgeSet).size !== metadata.badgeSet.length ||
    !metadata.badgeSet.every((badge) =>
      typeof badge === "string" &&
      APLUS_DOCUMENT_BADGES.has(badge as AplusDocumentBadge)
    ) ||
    !isExactText(metadata.updateTime, 64) ||
    !Number.isFinite(Date.parse(metadata.updateTime))
  ) return null;
  return {
    contentReferenceKey: value.contentReferenceKey,
    name: metadata.name,
    documentStatus: metadata.status as AplusDocumentStatus,
    badges: [...metadata.badgeSet as AplusDocumentBadge[]].sort((left, right) =>
      left.localeCompare(right)
    ),
    updateTime: metadata.updateTime,
    metadataCompleteness: "complete",
  };
}

function sameDocumentRecord(
  left: AplusDocumentRecord,
  right: AplusDocumentRecord,
): boolean {
  return (
    left.contentReferenceKey === right.contentReferenceKey &&
    left.name === right.name &&
    left.documentStatus === right.documentStatus &&
    JSON.stringify(left.badges) === JSON.stringify(right.badges) &&
    left.updateTime === right.updateTime
  );
}

function mergeDuplicateDocumentRecord(
  left: AplusDocumentRecord,
  right: AplusDocumentRecord,
): AplusDocumentRecord {
  // Amazon's ContentMetadataRecordList explicitly permits duplicate array
  // items. The opaque key still identifies the relation route; only the
  // mutable display metadata becomes partial when duplicate snapshots differ.
  if (sameDocumentRecord(left, right)) {
    return left.metadataCompleteness === "partial"
      ? left
      : right.metadataCompleteness === "partial"
        ? { ...left, metadataCompleteness: "partial" }
        : left;
  }
  const leftTime = Date.parse(left.updateTime);
  const rightTime = Date.parse(right.updateTime);
  const selected = rightTime > leftTime
    ? right
    : leftTime > rightTime
      ? left
      : JSON.stringify(right).localeCompare(JSON.stringify(left)) < 0
        ? right
        : left;
  return { ...selected, metadataCompleteness: "partial" };
}

function parseDocumentRelation(
  value: unknown,
): {
  asin: string;
  states: readonly AplusDocumentRelation["state"][];
  completeness: "complete" | "partial";
} | null {
  if (!isRecord(value) || typeof value.asin !== "string" || !/^[A-Z0-9]{10}$/u.test(value.asin)) {
    return null;
  }
  if (
    value.badgeSet !== undefined &&
    (
      !Array.isArray(value.badgeSet) ||
      value.badgeSet.length > APLUS_ASIN_BADGES.size ||
      new Set(value.badgeSet).size !== value.badgeSet.length ||
      !value.badgeSet.every((badge) =>
        typeof badge === "string" && APLUS_ASIN_BADGES.has(badge)
      )
    )
  ) return null;
  // The route path already identifies the exact content document. Amazon's
  // contentReferenceKeySet is optional display metadata, so a malformed value
  // must lower completeness without discarding an otherwise exact badge state.
  // A negative row with this drift still fails closed in the aggregate below.
  const contentReferenceKeySetComplete =
    value.contentReferenceKeySet === undefined ||
    (
      Array.isArray(value.contentReferenceKeySet) &&
      value.contentReferenceKeySet.length <= APLUS_AUDIT_MAX_PUBLIC_COUNT &&
      new Set(value.contentReferenceKeySet).size === value.contentReferenceKeySet.length &&
      value.contentReferenceKeySet.every((key) => isExactText(key, 2_048))
    );
  const badges = new Set(
    Array.isArray(value.badgeSet)
      ? value.badgeSet.filter((badge): badge is string => typeof badge === "string")
      : [],
  );
  const states: AplusDocumentRelation["state"][] = [];
  if (badges.has("CONTENT_PUBLISHED")) states.push("published");
  if (badges.has("CONTENT_NOT_PUBLISHED")) states.push("not_published");
  if (states.length === 0) states.push("related");
  return {
    asin: value.asin,
    states,
    completeness: contentReferenceKeySetComplete ? "complete" : "partial",
  };
}

async function readAplusDocumentIndex(input: Readonly<{
  marketplaceId: string;
  targetAsins: ReadonlySet<string>;
  budget: AplusPageBudget;
  fetchContentDocuments?: AplusContentDocumentFetcher;
  fetchContentDocumentAsinRelations?: AplusContentDocumentRelationFetcher;
  signal?: AbortSignal;
}>): Promise<AplusDocumentIndex> {
  if (!input.fetchContentDocuments || !input.fetchContentDocumentAsinRelations) {
    return {
      documentsByKey: new Map(),
      relationsByAsin: new Map(),
      conflictAsins: new Set(),
      partialAsins: new Set(),
      completeness: "unavailable",
    };
  }
  const documentsByKey = new Map<string, AplusDocumentRecord>();
  const seenDocumentPageTokens = new Set<string>();
  let documentPageToken: string | undefined;
  let partial = false;
  let documentPaginationComplete = false;
  for (let page = 0; page < 100; page += 1) {
    throwIfAuditAborted(input.signal);
    if (!claimAplusPage(input.budget)) {
      partial = true;
      break;
    }
    let response: AplusPublishRecordFetchResult;
    try {
      response = await input.fetchContentDocuments({
        marketplaceId: input.marketplaceId,
        pageToken: documentPageToken,
        signal: input.signal,
      });
      throwIfAuditAborted(input.signal);
    } catch (error) {
      throwIfAuditAborted(input.signal);
      throwIfAuditFence(error);
      partial = true;
      break;
    }
    if (response.status === 403 && documentsByKey.size === 0) {
      return {
        documentsByKey,
        relationsByAsin: new Map(),
        conflictAsins: new Set(),
        partialAsins: new Set(),
        completeness: "unavailable",
      };
    }
    if (response.status !== 200 || !isRecord(response.payload)) {
      partial = true;
      break;
    }
    const records = response.payload.contentMetadataRecords;
    if (!Array.isArray(records) || records.length > 10_000) {
      partial = true;
      break;
    }
    if (warningEnvelopeState(response.payload.warnings) !== "none") partial = true;
    for (const candidate of records) {
      const record = parseDocumentRecord(candidate, input.marketplaceId);
      if (!record) {
        partial = true;
        continue;
      }
      const previous = documentsByKey.get(record.contentReferenceKey);
      if (previous) {
        documentsByKey.set(
          record.contentReferenceKey,
          mergeDuplicateDocumentRecord(previous, record),
        );
        continue;
      }
      if (documentsByKey.size >= APLUS_AUDIT_MAX_PUBLIC_COUNT) {
        partial = true;
        continue;
      }
      documentsByKey.set(record.contentReferenceKey, record);
    }
    const nextPageToken = aplusPageToken(response.payload.nextPageToken);
    if (nextPageToken === "invalid") {
      partial = true;
      break;
    }
    if (nextPageToken === null) {
      documentPaginationComplete = true;
      break;
    }
    if (seenDocumentPageTokens.has(nextPageToken)) {
      partial = true;
      break;
    }
    seenDocumentPageTokens.add(nextPageToken);
    documentPageToken = nextPageToken;
  }
  if (!documentPaginationComplete) partial = true;

  const relationAggregates = new Map<string, {
    asin: string;
    contentReferenceKey: string;
    states: Set<AplusDocumentRelation["state"]>;
    invalid: boolean;
  }>();
  const conflictAsins = new Set<string>();
  const partialAsins = new Set<string>();
  const relationAggregate = (asin: string, contentReferenceKey: string) => {
    const compositeKey = JSON.stringify([asin, contentReferenceKey]);
    const previous = relationAggregates.get(compositeKey);
    if (previous) return previous;
    if (relationAggregates.size >= APLUS_MAX_RELATION_EDGES) {
      partial = true;
      return null;
    }
    const created = {
      asin,
      contentReferenceKey,
      states: new Set<AplusDocumentRelation["state"]>(),
      invalid: false,
    };
    relationAggregates.set(compositeKey, created);
    return created;
  };
  documentRelations: for (const document of [...documentsByKey.values()].sort((left, right) =>
    left.contentReferenceKey.localeCompare(right.contentReferenceKey)
  )) {
    if (relationAggregates.size >= APLUS_MAX_RELATION_EDGES) {
      partial = true;
      break;
    }
    let relationPageToken: string | undefined;
    const seenRelationPageTokens = new Set<string>();
    let relationPaginationComplete = false;
    for (let page = 0; page < 100; page += 1) {
      throwIfAuditAborted(input.signal);
      if (!claimAplusPage(input.budget)) {
        partial = true;
        break documentRelations;
      }
      let response: AplusPublishRecordFetchResult;
      try {
        response = await input.fetchContentDocumentAsinRelations({
          marketplaceId: input.marketplaceId,
          contentReferenceKey: document.contentReferenceKey,
          pageToken: relationPageToken,
          signal: input.signal,
        });
        throwIfAuditAborted(input.signal);
      } catch (error) {
        throwIfAuditAborted(input.signal);
        throwIfAuditFence(error);
        partial = true;
        break;
      }
      if (response.status !== 200 || !isRecord(response.payload)) {
        partial = true;
        break;
      }
      const metadataSet = response.payload.asinMetadataSet;
      if (!Array.isArray(metadataSet) || metadataSet.length > 10_000) {
        partial = true;
        break;
      }
      if (warningEnvelopeState(response.payload.warnings) !== "none") partial = true;
      for (const candidate of metadataSet) {
        const exactCandidateAsin = isRecord(candidate) &&
            typeof candidate.asin === "string" &&
            /^[A-Z0-9]{10}$/u.test(candidate.asin)
          ? candidate.asin
          : null;
        const relation = parseDocumentRelation(candidate);
        if (!relation) {
          if (exactCandidateAsin === null) {
            // Without an exact ASIN, the malformed row could conceal any
            // target relation, so negative conclusions remain globally partial.
            partial = true;
          } else if (input.targetAsins.has(exactCandidateAsin)) {
            const aggregate = relationAggregate(
              exactCandidateAsin,
              document.contentReferenceKey,
            );
            if (!aggregate) break documentRelations;
            aggregate.invalid = true;
            partialAsins.add(exactCandidateAsin);
          }
          // A malformed row with an exact non-target ASIN cannot change the
          // coverage of any requested FBA ASIN.
          continue;
        }
        if (!input.targetAsins.has(relation.asin)) continue;
        const aggregate = relationAggregate(
          relation.asin,
          document.contentReferenceKey,
        );
        if (!aggregate) break documentRelations;
        if (relation.completeness === "partial") {
          aggregate.invalid = true;
          partialAsins.add(relation.asin);
        }
        for (const state of relation.states) {
          aggregate.states.add(state);
        }
      }
      const nextPageToken = aplusPageToken(response.payload.nextPageToken);
      if (nextPageToken === "invalid") {
        partial = true;
        break;
      }
      if (nextPageToken === null) {
        relationPaginationComplete = true;
        break;
      }
      if (seenRelationPageTokens.has(nextPageToken)) {
        partial = true;
        break;
      }
      seenRelationPageTokens.add(nextPageToken);
      relationPageToken = nextPageToken;
    }
    if (!relationPaginationComplete) partial = true;
  }

  const relationByCompositeKey = new Map<string, AplusDocumentRelation>();
  for (const [compositeKey, aggregate] of relationAggregates) {
    const hasPublished = aggregate.states.has("published");
    const hasNotPublished = aggregate.states.has("not_published");
    if (aggregate.invalid && !hasPublished) {
      conflictAsins.add(aggregate.asin);
      partialAsins.add(aggregate.asin);
      continue;
    }
    if (aggregate.states.size === 0) continue;
    const relationIsPartial = aggregate.invalid || aggregate.states.size > 1;
    if (relationIsPartial) partialAsins.add(aggregate.asin);
    relationByCompositeKey.set(compositeKey, {
      contentReferenceKey: aggregate.contentReferenceKey,
      state: hasPublished
        ? "published"
        : hasNotPublished
          ? "not_published"
          : "related",
      completeness: relationIsPartial ? "partial" : "complete",
    });
  }

  const relationsByAsin = new Map<string, AplusDocumentRelation[]>();
  for (const [compositeKey, relation] of relationByCompositeKey) {
    const parsed = JSON.parse(compositeKey) as [string, string];
    const asin = parsed[0];
    const list = relationsByAsin.get(asin) ?? [];
    list.push(relation);
    relationsByAsin.set(asin, list);
  }
  for (const list of relationsByAsin.values()) {
    list.sort((left, right) =>
      left.contentReferenceKey.localeCompare(right.contentReferenceKey)
    );
  }
  return {
    documentsByKey,
    relationsByAsin,
    conflictAsins,
    partialAsins,
    completeness: partial ? "partial" : "complete",
  };
}

function mergeDocumentEvidence(input: Readonly<{
  asin: string;
  read: AsinReadResult;
  index: AplusDocumentIndex;
}>): Pick<
  AplusAuditRow,
  | "status"
  | "sourceCompleteness"
  | "publishedRecordCount"
  | "contentTypes"
  | "locales"
  | "documents"
  | "documentEvidenceCompleteness"
  | "reasonCode"
  | "reason"
> {
  const relations = input.index.relationsByAsin.get(input.asin) ?? [];
  const relationByKey = new Map(
    relations.map((relation) => [relation.contentReferenceKey, relation]),
  );
  const publishKeys = new Set(input.read.contentReferenceKeys);
  const documents: AplusDocumentEvidence[] = [];
  const relationshipConflict = input.index.conflictAsins.has(input.asin);
  const asinEvidencePartial = input.index.partialAsins.has(input.asin);
  let evidencePartial = input.index.completeness !== "complete" ||
    asinEvidencePartial ||
    relationshipConflict;
  let publicationConflict = false;
  for (const contentReferenceKey of publishKeys) {
    const document = input.index.documentsByKey.get(contentReferenceKey);
    const relation = relationByKey.get(contentReferenceKey);
    const relationConflicts = relation?.state === "not_published";
    if (
      (!document && input.index.completeness !== "unavailable") ||
      relationConflicts ||
      document?.metadataCompleteness === "partial" ||
      relation?.completeness === "partial"
    ) evidencePartial = true;
    if (relationConflicts) publicationConflict = true;
    documents.push({
      name: document?.name ?? null,
      documentStatus: document?.documentStatus ?? null,
      badges: document?.badges ?? [],
      relationState: "published",
      evidence: "publish_record",
      completeness: !document ||
          relationConflicts ||
          document.metadataCompleteness === "partial" ||
          relation?.completeness === "partial" ||
          relationshipConflict ||
          input.index.completeness !== "complete"
        ? "partial"
        : "complete",
    });
  }
  for (const relation of relations) {
    if (publishKeys.has(relation.contentReferenceKey)) continue;
    const document = input.index.documentsByKey.get(relation.contentReferenceKey);
    if (!document) {
      evidencePartial = true;
      continue;
    }
    const relationEvidencePartial =
      document.metadataCompleteness === "partial" ||
      relation.completeness === "partial" ||
      input.index.completeness !== "complete";
    if (relationEvidencePartial) evidencePartial = true;
    documents.push({
      name: document.name,
      documentStatus: document.documentStatus,
      badges: document.badges,
      relationState: relation.state,
      evidence: relation.state === "published" ? "relation_badge" : "relation_only",
      completeness: relationEvidencePartial ? "partial" : "complete",
    });
  }
  documents.sort((left, right) =>
    (left.name ?? "\uffff").localeCompare(right.name ?? "\uffff") ||
    (left.documentStatus ?? "").localeCompare(right.documentStatus ?? "") ||
    left.relationState.localeCompare(right.relationState) ||
    left.evidence.localeCompare(right.evidence)
  );
  if (documents.length > APLUS_MAX_DOCUMENTS_PER_ASIN) evidencePartial = true;
  const boundedDocuments = documents.slice(0, APLUS_MAX_DOCUMENTS_PER_ASIN);
  const relationPublished = relations.some((relation) => relation.state === "published");
  const canPromotePublishedRelation = relationPublished && !publicationConflict;
  let outcome = input.read.outcome;
  if (outcome.status === "published") {
    if (relationshipConflict || publicationConflict) {
      outcome = {
        ...outcome,
        sourceCompleteness: "partial",
        publishedRecordCount: null,
        reason: "Amazon exact publish record 已證明目前 ASIN 有 A+；文件關聯資料未完整或互相衝突，因此不顯示完整筆數。",
      };
    }
  } else if (canPromotePublishedRelation) {
    outcome = {
      status: "published",
      sourceCompleteness: "partial",
      publishedRecordCount: null,
      contentTypes: [],
      locales: [],
      reasonCode: "PUBLISHED_DOCUMENT_RELATION_FOUND",
      reason: "Amazon A+ 文件與 ASIN 關聯的 CONTENT_PUBLISHED 已證明目前有已發布 A+；publish record 或其他文件關聯未完整，因此不顯示完整筆數。",
    };
  } else if (relationshipConflict) {
    outcome = outcome.reasonCode === "FBA_RELATIONSHIP_INCOMPLETE"
      ? {
          ...outcome,
          sourceCompleteness: "partial",
          publishedRecordCount: null,
          reason:
            "Amazon variation relationships 未完整，且 A+ 文件與 ASIN 關聯資料互相衝突；未發出逐 ASIN publish-record request，不能判定是否已發布。",
        }
      : {
          status: "incomplete",
          sourceCompleteness: "partial",
          publishedRecordCount: null,
          contentTypes: [],
          locales: [],
          reasonCode: "A_PLUS_RESPONSE_INVALID",
          reason: "Amazon A+ 文件與 ASIN 關聯資料互相衝突，不能判定是否已發布。",
        };
  } else if (
    outcome.status === "missing" &&
    input.index.completeness !== "complete"
  ) {
    outcome = {
      status: "incomplete",
      sourceCompleteness: "partial",
      publishedRecordCount: null,
      contentTypes: [],
      locales: [],
      reasonCode: "A_PLUS_READ_FAILED",
      reason:
        "Amazon publish-record 完整空清單，但 A+ 文件與 ASIN 關聯索引未完整，可能漏掉 CONTENT_PUBLISHED；不能判定為未發布。",
    };
  }
  const documentEvidenceCompleteness = input.index.completeness === "unavailable"
    ? "unavailable" as const
    : evidencePartial || relationshipConflict
      ? "partial" as const
      : "complete" as const;
  return {
    ...outcome,
    documents: boundedDocuments,
    documentEvidenceCompleteness,
  };
}

async function readAsin(
  marketplaceId: string,
  asin: string,
  fetchPublishRecords: AplusPublishRecordFetcher,
  budget: AplusPageBudget,
  signal?: AbortSignal,
): Promise<AsinReadResult> {
  throwIfAuditAborted(signal);
  let pageToken: string | undefined;
  const recordKeys = new Set<string>();
  const contentReferenceKeys = new Set<string>();
  const contentTypes = new Set<"EBC" | "EMC">();
  const locales = new Set<string>();
  const seenPageTokens = new Set<string>();
  const finish = (outcome: AsinResult): AsinReadResult => ({
    outcome,
    contentReferenceKeys: [...contentReferenceKeys].sort((left, right) =>
      left.localeCompare(right)
    ),
  });
  let warningResult: AsinResult | null = null;
  for (let page = 0; page < 100; page += 1) {
    throwIfAuditAborted(signal);
    if (!claimAplusPage(budget)) {
      return finish(partialEvidenceResult(
        recordKeys.size,
        contentTypes,
        locales,
        paginationFailure(),
      ));
    }
    let response: AplusPublishRecordFetchResult;
    try {
      response = await fetchPublishRecords({
        marketplaceId,
        asin,
        pageToken,
        signal,
      });
      throwIfAuditAborted(signal);
    } catch (error) {
      throwIfAuditAborted(signal);
      throwIfAuditFence(error);
      return finish(partialEvidenceResult(
        recordKeys.size,
        contentTypes,
        locales,
        readFailure(0),
      ));
    }
    if (response.status !== 200) {
      return finish(partialEvidenceResult(
        recordKeys.size,
        contentTypes,
        locales,
        readFailure(response.status),
      ));
    }
    const parsed = parsePublishRecordPage(marketplaceId, asin, response.payload);
    if (parsed.status === "published") {
      const rawRecords = (response.payload as Record<string, unknown>).publishRecordList;
      for (const record of Array.isArray(rawRecords) ? rawRecords : []) {
        if (!isPublishRecord(record, marketplaceId, asin)) continue;
        const recordKey = JSON.stringify([
          marketplaceId,
          asin,
          record.contentReferenceKey,
          record.contentType,
          record.contentSubType ?? null,
          record.locale,
        ]);
        if (
          !recordKeys.has(recordKey) &&
          recordKeys.size >= APLUS_AUDIT_MAX_PUBLIC_COUNT
        ) {
          return finish(partialEvidenceResult(
            recordKeys.size,
            contentTypes,
            locales,
            paginationFailure(),
          ));
        }
        if (
          !locales.has(record.locale) &&
          locales.size >= APLUS_AUDIT_MAX_PUBLIC_LOCALES_PER_ASIN
        ) {
          return finish(partialEvidenceResult(
            recordKeys.size,
            contentTypes,
            locales,
            paginationFailure(),
          ));
        }
        recordKeys.add(recordKey);
        contentReferenceKeys.add(record.contentReferenceKey);
        contentTypes.add(record.contentType);
        locales.add(record.locale);
      }
    }
    if (
      parsed.status === "incomplete" &&
      parsed.reasonCode === "A_PLUS_WARNING_PRESENT"
    ) {
      warningResult = parsed;
    } else if (parsed.status === "incomplete") {
      return finish(partialEvidenceResult(
        recordKeys.size,
        contentTypes,
        locales,
        parsed,
      ));
    }
    if (parsed.status === "published" && parsed.sourceCompleteness === "partial") {
      return finish(partialEvidenceResult(
        recordKeys.size,
        contentTypes,
        locales,
        parsed,
      ));
    }
    const raw = response.payload as Record<string, unknown>;
    if (
      raw.nextPageToken !== undefined &&
      raw.nextPageToken !== null &&
      !isExactText(raw.nextPageToken, 2_048)
    ) {
      return finish(partialEvidenceResult(
        recordKeys.size,
        contentTypes,
        locales,
        paginationFailure(),
      ));
    }
    const nextPageToken = typeof raw.nextPageToken === "string"
      ? raw.nextPageToken
      : undefined;
    if (!nextPageToken) {
      if (recordKeys.size > 0) {
        return finish(warningResult
          ? partialEvidenceResult(
              recordKeys.size,
              contentTypes,
              locales,
              warningResult,
            )
          : {
            status: "published",
            sourceCompleteness: "complete",
            publishedRecordCount: recordKeys.size,
            contentTypes: [...contentTypes].sort((left, right) => left.localeCompare(right)),
            locales: [...locales].sort((left, right) => left.localeCompare(right)),
            reasonCode: "PUBLISHED_RECORD_FOUND",
            reason: "Amazon publish record 已證明目前 ASIN 有已發布 A+。",
          });
      }
      return finish(warningResult ?? parsed);
    }
    if (seenPageTokens.has(nextPageToken)) {
      return finish(partialEvidenceResult(
        recordKeys.size,
        contentTypes,
        locales,
        paginationFailure(),
      ));
    }
    seenPageTokens.add(nextPageToken);
    pageToken = nextPageToken;
  }
  return finish(partialEvidenceResult(
    recordKeys.size,
    contentTypes,
    locales,
    paginationFailure(),
  ));
}

async function runAplusAudit(input: Readonly<{
  mode: "live" | "demo";
  marketplaceId: string;
  fetchedAt: string;
  fbaSnapshotId: string;
  rows: readonly AplusAuditSeed[];
  fetchPublishRecords: AplusPublishRecordFetcher;
  fetchContentDocuments?: AplusContentDocumentFetcher;
  fetchContentDocumentAsinRelations?: AplusContentDocumentRelationFetcher;
  signal?: AbortSignal;
  onProgress?: (
    progress: AplusAuditProgress,
  ) => void | Promise<void>;
}>): Promise<AplusAuditSnapshot> {
  const seeds = normalizedSeeds(input);
  throwIfAuditAborted(input.signal);
  const byAsin = new Map<string, AsinReadResult>();
  const pageBudget: AplusPageBudget = {
    remaining: APLUS_MAX_PAGE_REQUESTS,
  };
  let accessUnavailable = false;
  const targetAsins = [...new Set(
    seeds.map((row) => row.asin).filter((value): value is string => Boolean(value)),
  )];
  const directQueryAsins = [...new Set(
    seeds.flatMap((row) =>
      row.asin && !row.incompleteReasonCode ? [row.asin] : []
    ),
  )];
  for (const asin of directQueryAsins) {
    throwIfAuditAborted(input.signal);
    const result = accessUnavailable
      ? { outcome: readFailure(403), contentReferenceKeys: [] }
      : await readAsin(
          input.marketplaceId,
          asin,
          input.fetchPublishRecords,
          pageBudget,
          input.signal,
        );
    byAsin.set(asin, result);
    if (result.outcome.status === "unavailable") accessUnavailable = true;
    try {
      await input.onProgress?.(Object.freeze({
        completedAsins: byAsin.size,
        totalAsins: targetAsins.length,
      }));
    } catch {
      // Progress is observability only. A failed observer cannot rewrite the
      // Amazon evidence or turn a completed ASIN back into an unknown state.
    }
    throwIfAuditAborted(input.signal);
  }
  const documentIndex = await readAplusDocumentIndex({
    marketplaceId: input.marketplaceId,
    targetAsins: new Set(targetAsins),
    budget: pageBudget,
    fetchContentDocuments: input.fetchContentDocuments,
    fetchContentDocumentAsinRelations: input.fetchContentDocumentAsinRelations,
    signal: input.signal,
  });
  throwIfAuditAborted(input.signal);
  if (byAsin.size < targetAsins.length) {
    try {
      await input.onProgress?.(Object.freeze({
        completedAsins: targetAsins.length,
        totalAsins: targetAsins.length,
      }));
    } catch {
      // Progress is observability only. Document evidence remains authoritative.
    }
    throwIfAuditAborted(input.signal);
  }
  const rows = seeds.map((row): AplusAuditRow => ({
    sellerSku: row.sellerSku,
    asin: row.asin,
    title: row.title,
    marketplaceId: input.marketplaceId,
    ...(row.asin
      ? mergeDocumentEvidence({
          asin: row.asin,
          read: row.incompleteReasonCode
            ? relationshipIncompleteRead()
            : byAsin.get(row.asin)!,
          index: documentIndex,
        })
      : {
          status: "incomplete" as const,
          sourceCompleteness: "partial" as const,
          publishedRecordCount: null,
          contentTypes: [],
          locales: [],
          documents: [],
          documentEvidenceCompleteness: "unavailable" as const,
          reasonCode: row.incompleteReasonCode ?? "FBA_IDENTITY_INCOMPLETE" as const,
          reason: row.incompleteReasonCode === "FBA_RELATIONSHIP_INCOMPLETE"
            ? "Amazon relationships 未完整證明此 FBA 商品為 child 或 standalone，未發出 A+ request。"
            : "FBA 商品缺少可安全核對的 ASIN，未發出 A+ request。",
        }),
  }));
  const summary = {
    eligibleFbaSkus: rows.length,
    uniqueAsins: targetAsins.length,
    published: rows.filter((row) => row.status === "published").length,
    missing: rows.filter((row) => row.status === "missing").length,
    incomplete: rows.filter((row) => row.status === "incomplete").length,
    unavailable: rows.filter((row) => row.status === "unavailable").length,
  };
  return {
    mode: input.mode,
    marketplaceId: input.marketplaceId,
    fetchedAt: input.fetchedAt,
    fbaSnapshotId: input.fbaSnapshotId,
    totals: summary,
    summary,
    rows,
    notice: "只讀取目前 FBA 商品的官方 A+ publish records、Content Manager 文件與 ASIN 關聯；顯示文件名稱與發布證據，不會修改 Amazon 商品頁。",
  };
}

export type AplusContentPageOperation =
  | "publish-records"
  | "content-documents"
  | "document-relations";

type AplusContentPagePlanBase = Readonly<{
  marketplaceId: MarketplaceId;
  expectedMode: SpExecutionMode;
  pageToken?: string;
  signal?: AbortSignal;
  onControlledWait?: () => void;
}>;

export type AplusContentPagePlan =
  | (AplusContentPagePlanBase & Readonly<{
      operation: "publish-records";
      asin: string;
    }>)
  | (AplusContentPagePlanBase & Readonly<{
      operation: "content-documents";
    }>)
  | (AplusContentPagePlanBase & Readonly<{
      operation: "document-relations";
      contentReferenceKey: string;
    }>);

type WithoutExpectedMode<T> = T extends unknown
  ? Omit<T, "expectedMode">
  : never;
type AplusContentPagePlanWithoutMode =
  WithoutExpectedMode<AplusContentPagePlan>;

export type AplusContentPageResult = AplusPublishRecordFetchResult & Readonly<{
  requestId: string | null;
}>;

/**
 * True-external A+ Content seam. Implementations receive only the three fixed
 * read intents used by the audit; callers cannot provide a host, path, method,
 * query name, arbitrary URL, or write capability.
 */
export interface AplusContentPageAdapter {
  read(plan: AplusContentPagePlan): Promise<AplusContentPageResult>;
}

export type AplusContentReadInput = Readonly<{
  marketplaceId: MarketplaceId;
  fetchedAt: string;
  fbaSnapshotId: string;
  rows: readonly AplusAuditSeed[];
  expectedContext?: SpExecutionContext;
  signal?: AbortSignal;
  onProgress?: (
    progress: AplusAuditProgress,
  ) => void | Promise<void>;
  onControlledWait?: (operation: AplusContentPageOperation) => void;
}>;

export interface AplusContentReadsPort {
  read(input: AplusContentReadInput): Promise<AplusAuditSnapshot>;
}

export function createDeterministicAplusContentDemoAdapter():
  AplusContentPageAdapter {
  return {
    async read(plan) {
      throwIfAborted(plan.signal);
      if (plan.expectedMode !== "demo") {
        throw new Error("A+ 展示 adapter 不接受真實 Amazon request。");
      }
      if (plan.operation === "publish-records") {
        const ordinal = Number(plan.asin.at(-1));
        return {
          status: 200,
          payload: {
            publishRecordList: Number.isFinite(ordinal) && ordinal % 2 === 0
              ? [{
                  marketplaceId: plan.marketplaceId,
                  asin: plan.asin,
                  contentReferenceKey: `demo-a-plus-${plan.asin}`,
                  contentType: ordinal % 4 === 0 ? "EMC" : "EBC",
                  locale: "en-US",
                }]
              : [],
          },
          requestId: null,
        };
      }
      if (plan.operation === "content-documents") {
        return {
          status: 200,
          payload: {
            contentMetadataRecords: [{
              contentReferenceKey:
                `demo-a-plus-document-${plan.marketplaceId}`,
              contentMetadata: {
                name: "AMZ.API Demo A+ Content",
                marketplaceId: plan.marketplaceId,
                status: "APPROVED",
                badgeSet: ["STANDARD"],
                updateTime: "2026-01-01T00:00:00Z",
              },
            }],
          },
          requestId: null,
        };
      }
      return {
        status: 200,
        payload: {
          asinMetadataSet: [{
            asin: "B000000002",
            badgeSet: ["CONTENT_PUBLISHED"],
            contentReferenceKeySet: [plan.contentReferenceKey],
          }],
        },
        requestId: null,
      };
    },
  };
}

/**
 * Semantic owner of the bounded A+ Content read family. The module captures
 * one immutable execution context, selects live or deterministic-demo
 * transport once, and keeps publish-record, document and relationship
 * pagination plus evidence precedence behind one interface.
 */
export class AplusContentReads implements AplusContentReadsPort {
  private readonly context: SpExecutionContextAdapter;
  private readonly live: AplusContentPageAdapter;
  private readonly demo: AplusContentPageAdapter;

  constructor(input: Readonly<{
    context: SpExecutionContextAdapter;
    live: AplusContentPageAdapter;
    demo?: AplusContentPageAdapter;
  }>) {
    this.context = input.context;
    this.live = input.live;
    this.demo = input.demo ?? createDeterministicAplusContentDemoAdapter();
  }

  private async executionContext(
    marketplaceId: MarketplaceId,
    expected?: SpExecutionContext,
  ): Promise<SpExecutionContext> {
    if (!expected) return this.context.capture(marketplaceId);
    if (expected.marketplaceId !== marketplaceId) {
      throw new SpExecutionContextError(
        "SP_CONTEXT_INVALIDATED",
        "Amazon 執行環境與 A+ 健檢站點不一致；請重新開始。",
      );
    }
    await this.context.assertCurrent(expected);
    return expected;
  }

  private async readPage(
    context: SpExecutionContext,
    plan: AplusContentPagePlanWithoutMode,
    onControlledWait?: AplusContentReadInput["onControlledWait"],
  ): Promise<AplusContentPageResult> {
    await this.context.assertCurrent(context);
    throwIfAborted(plan.signal);
    const adapter = context.mode === "demo" ? this.demo : this.live;
    try {
      const result = await adapter.read({
        ...plan,
        expectedMode: context.mode,
        onControlledWait: () => onControlledWait?.(plan.operation),
      } as AplusContentPagePlan);
      await this.context.assertCurrent(context);
      throwIfAborted(plan.signal);
      return result;
    } catch (error) {
      await this.context.assertCurrent(context);
      throw error;
    }
  }

  async read(input: AplusContentReadInput): Promise<AplusAuditSnapshot> {
    throwIfAborted(input.signal);
    const context = await this.executionContext(
      input.marketplaceId,
      input.expectedContext,
    );
    const snapshot = await runAplusAudit({
      mode: context.mode,
      marketplaceId: input.marketplaceId,
      fetchedAt: input.fetchedAt,
      fbaSnapshotId: input.fbaSnapshotId,
      rows: input.rows,
      signal: input.signal,
      onProgress: input.onProgress,
      fetchPublishRecords: (request) => this.readPage(context, {
        operation: "publish-records",
        marketplaceId: input.marketplaceId,
        asin: request.asin,
        pageToken: request.pageToken,
        signal: request.signal,
      }, input.onControlledWait),
      fetchContentDocuments: (request) => this.readPage(context, {
        operation: "content-documents",
        marketplaceId: input.marketplaceId,
        pageToken: request.pageToken,
        signal: request.signal,
      }, input.onControlledWait),
      fetchContentDocumentAsinRelations: (request) => this.readPage(context, {
        operation: "document-relations",
        marketplaceId: input.marketplaceId,
        contentReferenceKey: request.contentReferenceKey,
        pageToken: request.pageToken,
        signal: request.signal,
      }, input.onControlledWait),
    });
    await this.context.assertCurrent(context);
    throwIfAborted(input.signal);
    return snapshot;
  }
}
