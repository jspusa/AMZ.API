import {
  APLUS_AUDIT_MAX_PUBLIC_COUNT,
  APLUS_AUDIT_MAX_PUBLIC_LOCALES_PER_ASIN,
  isAplusLanguageTag,
} from "../../shared/a-plus";

export type AplusAuditStatus =
  | "published"
  | "missing"
  | "incomplete"
  | "unavailable";

export type AplusAuditReasonCode =
  | "PUBLISHED_RECORD_FOUND"
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
 * allowed to reach the A+ reader. Parent containers are not auditable rows;
 * incomplete relationships remain visible but cannot carry a queryable ASIN.
 */
export function buildAplusAuditSeedsFromFbaGrouping(
  rows: readonly AplusFbaGroupingSeed[],
): AplusAuditSeed[] {
  return rows.flatMap((row): AplusAuditSeed[] => {
    if (row.status === "complete" && row.role === "parent") return [];
    if (
      row.status === "complete" &&
      (row.role === "child" || row.role === "standalone") &&
      /^[A-Z0-9]{10}$/u.test(row.asin)
    ) {
      return [{ sellerSku: row.sellerSku, asin: row.asin, title: row.title }];
    }
    return [{
      sellerSku: row.sellerSku,
      asin: null,
      title: row.title,
      incompleteReasonCode: "FBA_RELATIONSHIP_INCOMPLETE" as const,
    }];
  });
}

export type AplusPublishRecordFetchInput = Readonly<{
  marketplaceId: string;
  asin: string;
  pageToken?: string;
  signal?: AbortSignal;
}>;

export type AplusPublishRecordFetchResult = Readonly<{
  status: number;
  payload: unknown;
  requestId?: string | null;
}>;

export type AplusPublishRecordFetcher = (
  input: AplusPublishRecordFetchInput,
) => Promise<AplusPublishRecordFetchResult>;

export type AplusAuditProgress = Readonly<{
  completedAsins: number;
  totalAsins: number;
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

type AsinResult = Omit<AplusAuditRow, "sellerSku" | "title" | "asin" | "marketplaceId">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function throwIfAuditAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("A+ 健檢背景工作已中止。");
  error.name = "AbortError";
  throw error;
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
      (incompleteReasonCode !== "FBA_RELATIONSHIP_INCOMPLETE" || asin !== null)
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
    isExactText(value.contentReferenceKey, 512) &&
    (value.contentType === "EBC" || value.contentType === "EMC") &&
    isExactText(value.locale, 64) &&
    isAplusLanguageTag(value.locale) &&
    (value.contentSubType === undefined || isExactText(value.contentSubType, 256))
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

async function readAsin(
  marketplaceId: string,
  asin: string,
  fetchPublishRecords: AplusPublishRecordFetcher,
  signal?: AbortSignal,
): Promise<AsinResult> {
  throwIfAuditAborted(signal);
  let pageToken: string | undefined;
  const recordKeys = new Set<string>();
  const contentTypes = new Set<"EBC" | "EMC">();
  const locales = new Set<string>();
  const seenPageTokens = new Set<string>();
  let warningResult: AsinResult | null = null;
  for (let page = 0; page < 100; page += 1) {
    throwIfAuditAborted(signal);
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
      if (error instanceof Error && error.name === "AbortError") throw error;
      return partialEvidenceResult(
        recordKeys.size,
        contentTypes,
        locales,
        readFailure(0),
      );
    }
    if (response.status !== 200) {
      return partialEvidenceResult(
        recordKeys.size,
        contentTypes,
        locales,
        readFailure(response.status),
      );
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
          return partialEvidenceResult(
            recordKeys.size,
            contentTypes,
            locales,
            paginationFailure(),
          );
        }
        if (
          !locales.has(record.locale) &&
          locales.size >= APLUS_AUDIT_MAX_PUBLIC_LOCALES_PER_ASIN
        ) {
          return partialEvidenceResult(
            recordKeys.size,
            contentTypes,
            locales,
            paginationFailure(),
          );
        }
        recordKeys.add(recordKey);
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
      return partialEvidenceResult(
        recordKeys.size,
        contentTypes,
        locales,
        parsed,
      );
    }
    if (parsed.status === "published" && parsed.sourceCompleteness === "partial") {
      return partialEvidenceResult(
        recordKeys.size,
        contentTypes,
        locales,
        parsed,
      );
    }
    const raw = response.payload as Record<string, unknown>;
    if (
      raw.nextPageToken !== undefined &&
      raw.nextPageToken !== null &&
      !isExactText(raw.nextPageToken, 2_048)
    ) {
      return partialEvidenceResult(
        recordKeys.size,
        contentTypes,
        locales,
        paginationFailure(),
      );
    }
    const nextPageToken = typeof raw.nextPageToken === "string"
      ? raw.nextPageToken
      : undefined;
    if (!nextPageToken) {
      if (recordKeys.size > 0) {
        return warningResult
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
          };
      }
      return warningResult ?? parsed;
    }
    if (seenPageTokens.has(nextPageToken)) {
      return partialEvidenceResult(
        recordKeys.size,
        contentTypes,
        locales,
        paginationFailure(),
      );
    }
    seenPageTokens.add(nextPageToken);
    pageToken = nextPageToken;
  }
  return partialEvidenceResult(
    recordKeys.size,
    contentTypes,
    locales,
    paginationFailure(),
  );
}

export async function runAplusAudit(input: Readonly<{
  mode: "live" | "demo";
  marketplaceId: string;
  fetchedAt: string;
  fbaSnapshotId: string;
  rows: readonly AplusAuditSeed[];
  fetchPublishRecords: AplusPublishRecordFetcher;
  signal?: AbortSignal;
  onProgress?: (
    progress: AplusAuditProgress,
  ) => void | Promise<void>;
}>): Promise<AplusAuditSnapshot> {
  const seeds = normalizedSeeds(input);
  throwIfAuditAborted(input.signal);
  const byAsin = new Map<string, AsinResult>();
  let accessUnavailable = false;
  const uniqueAsins = [...new Set(
    seeds.map((row) => row.asin).filter((value): value is string => Boolean(value)),
  )];
  for (const asin of uniqueAsins) {
    throwIfAuditAborted(input.signal);
    const result = accessUnavailable
      ? readFailure(403)
      : await readAsin(
          input.marketplaceId,
          asin,
          input.fetchPublishRecords,
          input.signal,
        );
    byAsin.set(asin, result);
    if (result.status === "unavailable") accessUnavailable = true;
    try {
      await input.onProgress?.(Object.freeze({
        completedAsins: byAsin.size,
        totalAsins: uniqueAsins.length,
      }));
    } catch {
      // Progress is observability only. A failed observer cannot rewrite the
      // Amazon evidence or turn a completed ASIN back into an unknown state.
    }
    throwIfAuditAborted(input.signal);
  }
  const rows = seeds.map((row): AplusAuditRow => ({
    sellerSku: row.sellerSku,
    asin: row.asin,
    title: row.title,
    marketplaceId: input.marketplaceId,
    ...(row.asin
      ? byAsin.get(row.asin)!
      : {
          status: "incomplete" as const,
          sourceCompleteness: "partial" as const,
          publishedRecordCount: null,
          contentTypes: [],
          locales: [],
          reasonCode: row.incompleteReasonCode ?? "FBA_IDENTITY_INCOMPLETE" as const,
          reason: row.incompleteReasonCode === "FBA_RELATIONSHIP_INCOMPLETE"
            ? "Amazon relationships 未完整證明此 FBA 商品為 child 或 standalone，未發出 A+ request。"
            : "FBA 商品缺少可安全核對的 ASIN，未發出 A+ request。",
        }),
  }));
  const summary = {
    eligibleFbaSkus: rows.length,
    uniqueAsins: byAsin.size,
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
    notice: "只讀取目前 FBA 商品的官方 A+ publish records；不會修改 Amazon 商品頁。",
  };
}
