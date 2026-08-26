import {
  abortableDelay as wait,
  throwIfAborted as assertNotAborted,
} from "../abort-utils";
import type { MarketplaceId } from "../../shared/marketplaces";
import { planExactSellerSkuBatches } from "./exact-seller-sku-batches";
import type { ListingsReadAdapter } from "./listings-reads";
import {
  publicSpApiRequestId,
  SpApiError,
} from "./sp-api-error";
import {
  buildAllVariationFamilyRows,
  type AllVariationFamilyRow,
  type VerifiedVariationFamilyMember,
} from "./unbound-variation-audit";
import {
  dedupeFbaReviewCandidates,
  type DedupedFbaReviewCandidate,
  type FbaReviewCandidate,
  type ReviewAuditCandidateCoverage,
  type ReviewAuditRelationshipIncompleteRow,
} from "./review-audit";
import { customerFeedbackMarketplaceSupported } from
  "./customer-feedback-reads";
import {
  buildUnboundVariationSearchBatches,
  classifyUnboundVariationSearchBatch,
  incompleteVariationBatch,
  readVariationRelationshipBatch,
  type UnboundVariationAuditIncompleteRow,
  type UnboundVariationAuditRow,
  type UnboundVariationSearchSeed,
  type VerifiedFbaVariationRelationshipRow,
} from "./variation-relationship-evidence";

export {
  readVariationChildren,
  readVariationFamily,
  readVariationItem,
  resolveVariationSellerSkuByAsin,
  sellerSkuFromAsinSearchPayload,
} from "./variation-family-reads";
export type {
  VariationFamilyReadInput,
  VariationItemReadResult,
} from "./variation-family-reads";
export {
  buildUnboundVariationSearchBatches,
  classifyUnboundVariationSearchBatch,
} from "./variation-relationship-evidence";
export type {
  UnboundVariationAuditIncompleteRow,
  UnboundVariationAuditRow,
  UnboundVariationSearchBatchResult,
  UnboundVariationSearchSeed,
  VerifiedFbaVariationRelationshipRow,
} from "./variation-relationship-evidence";

export type UnboundVariationAuditSnapshot = {
  mode: "live" | "demo";
  marketplaceId: MarketplaceId;
  fetchedAt: string;
  rows: UnboundVariationAuditRow[];
  incompleteRows: UnboundVariationAuditIncompleteRow[];
  allVariationRows: AllVariationFamilyRow[];
  summary: {
    totalFbaListings: number;
    completed: number;
    unbound: number;
    boundChildren: number;
    parentContainers: number;
    incomplete: number;
  };
  notice: string;
};

export type VariationGroupingSourceRow = {
  sellerSku: string;
  asin: string;
  title: string;
};

export type FbaVariationGroupingRow<
  Row extends VariationGroupingSourceRow = VariationGroupingSourceRow,
> = Row & {
  role: "parent" | "child" | "standalone" | "unknown";
  parentSku: string | null;
  familyKey: string;
  theme: string | null;
  status: "complete" | "incomplete";
  message: string;
};

export type FbaVariationGroupingData<
  Row extends VariationGroupingSourceRow = VariationGroupingSourceRow,
> = {
  marketplaceId: MarketplaceId;
  fetchedAt: string;
  rows: FbaVariationGroupingRow<Row>[];
  notice: string;
};

export type FbaReviewAuditSeed = {
  sellerSku: string;
  asin: string;
  title: string;
};

export type FbaReviewAuditRelationshipBatch = {
  status: number;
  payload: unknown;
  requestId: string | null;
};

export type ReviewAuditCandidateSnapshot = {
  mode: "live" | "demo";
  marketplaceId: MarketplaceId;
  sourceCandidateCount: number;
  candidates: DedupedFbaReviewCandidate[];
  relationshipIncompleteRows: ReviewAuditRelationshipIncompleteRow[];
  coverage: ReviewAuditCandidateCoverage;
  notice: string;
};

/** Deterministic non-parent candidates for the renderer-only demo workflow. */
export function getDemoFbaReviewAuditCandidates(input: Readonly<{
  marketplaceId: MarketplaceId;
  signal?: AbortSignal;
}>): ReviewAuditCandidateSnapshot {
  assertNotAborted(input.signal);
  if (!customerFeedbackMarketplaceSupported(input.marketplaceId)) {
    throw new SpApiError(
      "Amazon Customer Feedback API 尚不支援此站點；未改用父變體或私有接口。",
      { status: 422, code: "MARKETPLACE_UNSUPPORTED" },
    );
  }
  const seeds = Array.from({ length: 6 }, (_, index) => ({
    sellerSku: `DEMO-REVIEW-${index + 1}`,
    asin: `B0DEMOREV${index + 1}`,
    title: `展示用 FBA 評論主題商品 ${index + 1}`,
    relationshipRole: index % 2 === 0 ? "child" as const : "standalone" as const,
  }));
  return {
    mode: "demo",
    marketplaceId: input.marketplaceId,
    sourceCandidateCount: seeds.length,
    candidates: dedupeFbaReviewCandidates(seeds),
    relationshipIncompleteRows: [],
    coverage: {
      sourceFbaListings: seeds.length,
      verifiedNonParentListings: seeds.length,
      verifiedChildListings: seeds.filter(({ relationshipRole }) =>
        relationshipRole === "child").length,
      verifiedStandaloneListings: seeds.filter(({ relationshipRole }) =>
        relationshipRole === "standalone").length,
      excludedParentContainers: 0,
      relationshipIncomplete: 0,
    },
    notice: "展示資料僅供非 parent FBA ASIN 版面與 Excel 測試，沒有呼叫 Amazon。",
  };
}

function incompleteVariationGroupingRow<Row extends VariationGroupingSourceRow>(
  row: Row,
  message: string,
): FbaVariationGroupingRow<Row> {
  return {
    ...row,
    role: "unknown",
    parentSku: null,
    familyKey: row.sellerSku,
    theme: null,
    status: "incomplete",
    message,
  };
}

export function completeVariationGroupingRow<
  Row extends VariationGroupingSourceRow,
>(
  row: Row,
  relationship: Pick<
    VerifiedFbaVariationRelationshipRow,
    "role" | "parentSku" | "variationTheme"
  >,
): FbaVariationGroupingRow<Row> {
  if (relationship.role === "child" && !relationship.parentSku) {
    return incompleteVariationGroupingRow(
      row,
      "Amazon 將此 SKU 標示為 child，但沒有回傳可核對的 parent SKU；未建立 family 分組。",
    );
  }
  if (relationship.role !== "child" && relationship.parentSku !== null) {
    return incompleteVariationGroupingRow(
      row,
      "Amazon 回傳的角色與 parent SKU 互相矛盾；未建立 family 分組。",
    );
  }
  const familyKey = relationship.role === "child"
    ? relationship.parentSku!
    : row.sellerSku;
  const message = relationship.role === "child"
    ? `Amazon relationships 已證明此 SKU 屬於 parent ${familyKey}。`
    : relationship.role === "parent"
      ? "Amazon relationships 已證明此 SKU 為 parent 容器。"
      : "Amazon relationships 已證明此 SKU 為 standalone。";
  return {
    ...row,
    role: relationship.role,
    parentSku: relationship.parentSku,
    familyKey,
    theme: relationship.variationTheme,
    status: "complete",
    message,
  };
}

function variationGroupingSignature(
  row: VerifiedFbaVariationRelationshipRow,
): string {
  return [
    row.role,
    row.parentSku ?? "",
    row.variationTheme?.trim().toUpperCase() ?? "",
  ].join("\u0000");
}

function stableRelationshipFailureMessage(error: unknown): string {
  if (error instanceof SpApiError) {
    if (error.code === "LISTING_IDENTITY_MISMATCH") {
      return "Amazon relationships 批次回應的 SKU、ASIN、商品類型或站點身分不完整；未建立 family 分組。";
    }
    if (error.code === "RATE_LIMITED") {
      return "Amazon relationships 批次查詢遭限流；本次未重送或推定 family。";
    }
    if (error.code === "UNAUTHORIZED") {
      return "Amazon 拒絕 relationships 批次查詢；未建立 family 分組。";
    }
  }
  return "Amazon relationships 批次查詢失敗；此批次未作任何推定。";
}

export async function readFbaVariationGroupingData<
  Row extends VariationGroupingSourceRow,
>(
  adapter: Pick<ListingsReadAdapter, "searchItems">,
  input: Readonly<{
    marketplaceId: MarketplaceId;
    rows: readonly Row[];
    signal?: AbortSignal;
    onProgress?: (progress: Readonly<{
      completedBatches: number;
      totalBatches: number;
    }>) => void | Promise<void>;
    pace?: (milliseconds: number) => Promise<void>;
    now?: () => Date;
  }>,
): Promise<FbaVariationGroupingData<Row>> {
  assertNotAborted(input.signal);
  const sourceBySku = new Map<string, Row>();
  for (const row of input.rows) {
    if (sourceBySku.has(row.sellerSku)) {
      throw new SpApiError("全商品匯出含有重複 Seller SKU，已停止變體分組。", {
        status: 409,
        code: "PAGINATION_CHANGED",
      });
    }
    sourceBySku.set(row.sellerSku, row);
  }

  const incompleteBySku = new Map<string, FbaVariationGroupingRow<Row>>();
  const queryableRows: Row[] = [];
  for (const row of input.rows) {
    if (!/^[A-Z0-9]{10}$/u.test(row.asin)) {
      incompleteBySku.set(
        row.sellerSku,
        incompleteVariationGroupingRow(
          row,
          "全商品匯出沒有可與 Listings summary 原樣比對的十碼 ASIN；未建立 family 分組。",
        ),
      );
    } else {
      queryableRows.push(row);
    }
  }
  const queryableBySku = new Map(
    queryableRows.map((row) => [row.sellerSku, row]),
  );
  const { batches, unqueryableSellerSkus } = planExactSellerSkuBatches(
    queryableRows.map((row) => row.sellerSku),
  );
  for (const sellerSku of unqueryableSellerSkus) {
    const row = queryableBySku.get(sellerSku)!;
    incompleteBySku.set(
      sellerSku,
      incompleteVariationGroupingRow(
        row,
        "此 Seller SKU 無法不失真地放入官方 identifiers 批次參數；未 trim、改名或降級猜測。",
      ),
    );
  }

  const verifiedBySku = new Map<string, VerifiedFbaVariationRelationshipRow>();
  const pace = input.pace ?? ((milliseconds) => wait(milliseconds, input.signal));
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    assertNotAborted(input.signal);
    const sellerSkus = batches[batchIndex]!;
    const seeds = sellerSkus.map((sellerSku) => {
      const row = queryableBySku.get(sellerSku)!;
      return { sellerSku, asin: row.asin, title: row.title };
    });
    try {
      const readResult = await readVariationRelationshipBatch(adapter, {
        marketplaceId: input.marketplaceId,
        sellerSkus,
        signal: input.signal,
      });
      assertNotAborted(input.signal);
      const result = classifyUnboundVariationSearchBatch({
        marketplaceId: input.marketplaceId,
        seeds,
        status: readResult.status,
        payload: readResult.envelope,
        requestId: readResult.requestId,
      });
      for (const row of result.verifiedRows) {
        verifiedBySku.set(row.sellerSku, row);
      }
      for (const incomplete of result.incompleteRows) {
        const source = queryableBySku.get(incomplete.sellerSku)!;
        incompleteBySku.set(
          incomplete.sellerSku,
          incompleteVariationGroupingRow(source, incomplete.message),
        );
      }
    } catch (error) {
      assertNotAborted(input.signal);
      const message = stableRelationshipFailureMessage(error);
      for (const sellerSku of sellerSkus) {
        const row = queryableBySku.get(sellerSku)!;
        incompleteBySku.set(
          sellerSku,
          incompleteVariationGroupingRow(row, message),
        );
      }
    }
    if (batchIndex + 1 < batches.length) await pace(220);
    assertNotAborted(input.signal);
    await input.onProgress?.({
      completedBatches: batchIndex + 1,
      totalBatches: batches.length,
    });
    assertNotAborted(input.signal);
  }

  const verifiedByAsin = new Map<
    string,
    VerifiedFbaVariationRelationshipRow[]
  >();
  for (const row of verifiedBySku.values()) {
    const values = verifiedByAsin.get(row.asin) ?? [];
    values.push(row);
    verifiedByAsin.set(row.asin, values);
  }
  for (const rows of verifiedByAsin.values()) {
    const signatures = new Set(rows.map(variationGroupingSignature));
    if (signatures.size <= 1) continue;
    for (const relationship of rows) {
      const source = sourceBySku.get(relationship.sellerSku)!;
      incompleteBySku.set(
        relationship.sellerSku,
        incompleteVariationGroupingRow(
          source,
          "同一 ASIN 在同次 relationships 查詢中出現互相衝突的角色、parent 或 variation theme；未建立 family 分組。",
        ),
      );
      verifiedBySku.delete(relationship.sellerSku);
    }
  }
  const rows = input.rows.map((row) => {
    const incomplete = incompleteBySku.get(row.sellerSku);
    if (incomplete) return incomplete;
    const relationship = verifiedBySku.get(row.sellerSku);
    if (relationship) return completeVariationGroupingRow(row, relationship);
    return incompleteVariationGroupingRow(
      row,
      "relationships 覆蓋未與輸入匯出列完整對齊；未建立 family 分組。",
    );
  });
  return {
    marketplaceId: input.marketplaceId,
    fetchedAt: (input.now ?? (() => new Date()))().toISOString(),
    rows,
    notice:
      "每批最多 20 個 Seller SKU 以官方 searchListingsItems relationships 核對；缺列、400、ASIN 衝突與任何不完整證據均保留為 unknown，不會猜測 family。",
  };
}

export async function verifyFbaReviewAuditSeeds(
  adapter: Pick<ListingsReadAdapter, "searchItems">,
  input: Readonly<{
    marketplaceId: MarketplaceId;
    seeds: readonly FbaReviewAuditSeed[];
    signal?: AbortSignal;
    pace?: (milliseconds: number) => Promise<void>;
  }>,
): Promise<ReviewAuditCandidateSnapshot> {
  assertNotAborted(input.signal);
  const relationshipIncompleteRows: ReviewAuditRelationshipIncompleteRow[] = [];
  const seedBySku = new Map<string, FbaReviewAuditSeed>();
  for (const seed of input.seeds) {
    if (seedBySku.has(seed.sellerSku)) {
      throw new SpApiError("評論健檢來源含有重複 Seller SKU。", {
        status: 409,
        code: "PAGINATION_CHANGED",
      });
    }
    seedBySku.set(seed.sellerSku, seed);
  }
  const validAsinSeeds = input.seeds.filter((seed) => {
    if (/^[A-Z0-9]{10}$/u.test(seed.asin)) return true;
    relationshipIncompleteRows.push({
      sellerSku: seed.sellerSku,
      asin: seed.asin,
      title: seed.title || "Amazon 未提供商品名稱",
      code: "REPORT_ASIN_INVALID",
      message:
        "Amazon FBA 全商品報表沒有可與 Listings summary 原樣比對的十碼 ASIN；此 SKU 未查詢評論主題。",
      requestId: null,
    });
    return false;
  });
  const { batches, unqueryableSellerSkus } = planExactSellerSkuBatches(
    validAsinSeeds.map(({ sellerSku }) => sellerSku),
  );
  for (const sellerSku of unqueryableSellerSkus) {
    const seed = seedBySku.get(sellerSku)!;
    relationshipIncompleteRows.push({
      sellerSku,
      asin: seed.asin,
      title: seed.title || "Amazon 未提供商品名稱",
      code: "SELLER_SKU_UNQUERYABLE",
      message:
        "此 Seller SKU 無法不失真地放入官方 identifiers 批次參數；未 trim、改名或降級為逐 SKU 查詢。",
      requestId: null,
    });
  }
  const verifiedRows: VerifiedFbaVariationRelationshipRow[] = [];
  const pace = input.pace ?? ((milliseconds) => wait(milliseconds, input.signal));
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    assertNotAborted(input.signal);
    const sellerSkus = batches[batchIndex]!;
    const batchSeeds = sellerSkus.map((sellerSku) => seedBySku.get(sellerSku)!);
    try {
      const response = await readVariationRelationshipBatch(adapter, {
        marketplaceId: input.marketplaceId,
        sellerSkus,
        signal: input.signal,
      });
      assertNotAborted(input.signal);
      const result = classifyUnboundVariationSearchBatch({
        marketplaceId: input.marketplaceId,
        seeds: batchSeeds,
        status: response.status,
        payload: response.envelope,
        requestId: response.requestId,
      });
      verifiedRows.push(...result.verifiedRows);
      relationshipIncompleteRows.push(...result.incompleteRows);
    } catch (error) {
      assertNotAborted(input.signal);
      const failed = incompleteVariationBatch(
        batchSeeds,
        "RELATIONSHIP_QUERY_FAILED",
        stableRelationshipFailureMessage(error),
        error instanceof SpApiError ? error.requestId : null,
      );
      relationshipIncompleteRows.push(...failed.incompleteRows);
    }
    if (batchIndex + 1 < batches.length) await pace(220);
    assertNotAborted(input.signal);
  }

  const byAsin = new Map<string, VerifiedFbaVariationRelationshipRow[]>();
  for (const row of verifiedRows) {
    const group = byAsin.get(row.asin) ?? [];
    group.push(row);
    byAsin.set(row.asin, group);
  }
  const candidatesBeforeDedupe: FbaReviewCandidate[] = [];
  let excludedParentContainers = 0;
  for (const rows of byAsin.values()) {
    const roles = new Set(rows.map(({ role }) => role));
    if (roles.size !== 1) {
      relationshipIncompleteRows.push(...rows.map((row) => ({
        sellerSku: row.sellerSku,
        asin: row.asin,
        title: seedBySku.get(row.sellerSku)?.title || row.title,
        code: "RELATIONSHIP_ROLE_CONFLICT" as const,
        message:
          "同一 ASIN 的 Seller SKU 在同次 Listings relationships 回應中出現不同 parent／child／standalone 角色；未合併，也未查詢評論主題。",
        requestId: row.requestId,
      })));
      continue;
    }
    const role = rows[0]!.role;
    if (role === "parent") {
      excludedParentContainers += rows.length;
      continue;
    }
    candidatesBeforeDedupe.push(...rows.map((row) => ({
      sellerSku: row.sellerSku,
      asin: row.asin,
      title: seedBySku.get(row.sellerSku)?.title || row.title,
      relationshipRole: role,
    })));
  }
  const candidates = dedupeFbaReviewCandidates(candidatesBeforeDedupe);
  const verifiedChildListings = candidatesBeforeDedupe.filter(
    ({ relationshipRole }) => relationshipRole === "child",
  ).length;
  const verifiedStandaloneListings =
    candidatesBeforeDedupe.length - verifiedChildListings;
  const coverage: ReviewAuditCandidateCoverage = {
    sourceFbaListings: input.seeds.length,
    verifiedNonParentListings: candidatesBeforeDedupe.length,
    verifiedChildListings,
    verifiedStandaloneListings,
    excludedParentContainers,
    relationshipIncomplete: relationshipIncompleteRows.length,
  };
  if (
    coverage.sourceFbaListings !==
      coverage.verifiedNonParentListings +
        coverage.excludedParentContainers +
        coverage.relationshipIncomplete
  ) {
    throw new SpApiError(
      "評論健檢的 relationship 覆蓋無法與 FBA 來源逐列對齊，已停止輸出。",
      { status: 502, code: "RELATIONSHIP_RESPONSE_INVALID" },
    );
  }
  return {
    mode: "live",
    marketplaceId: input.marketplaceId,
    sourceCandidateCount: input.seeds.length,
    candidates,
    relationshipIncompleteRows: relationshipIncompleteRows
      .map((row) => ({
        ...row,
        requestId: publicSpApiRequestId(row.requestId),
        asin: row.asin.length <= 40 && row.asin === row.asin.trim() &&
            !/[\u0000-\u001f\u007f]/u.test(row.asin)
          ? row.asin
          : "",
        title: row.title || "Amazon 未提供商品名稱",
      }))
      .sort((left, right) => left.sellerSku.localeCompare(right.sellerSku, "en")),
    coverage,
    notice:
      "FBA 範圍取自同次全商品報表；每批最多 20 個 Seller SKU 以官方 searchListingsItems 核對 summaries 與 relationships。只將已證明為 child 或 standalone 的非 parent ASIN 送往 Customer Feedback；parent 容器與證據未完成列不會送出。",
  };
}

export async function readUnboundVariationAudit(
  adapter: Pick<ListingsReadAdapter, "searchItems">,
  input: Readonly<{
    marketplaceId: MarketplaceId;
    seeds: readonly UnboundVariationSearchSeed[];
    signal?: AbortSignal;
    pace?: (milliseconds: number) => Promise<void>;
    now?: () => Date;
  }>,
): Promise<UnboundVariationAuditSnapshot> {
  assertNotAborted(input.signal);
  const rows: UnboundVariationAuditRow[] = [];
  const incompleteRows: UnboundVariationAuditIncompleteRow[] = [];
  const verifiedVariationMembers: VerifiedVariationFamilyMember[] = [];
  let boundChildren = 0;
  let parentContainers = 0;
  const seedBySku = new Map(input.seeds.map((seed) => [seed.sellerSku, seed]));
  const { batches, unqueryableSellerSkus } = buildUnboundVariationSearchBatches(
    input.seeds.map((seed) => seed.sellerSku),
  );
  for (const sellerSku of unqueryableSellerSkus) {
    const seed = seedBySku.get(sellerSku)!;
    incompleteRows.push({
      sellerSku: seed.sellerSku,
      asin: seed.asin,
      title: seed.title,
      code: "RELATIONSHIP_QUERY_FAILED",
      message:
        "此 Seller SKU 無法不失真地放入官方 identifiers 批次參數；未 trim、改名或降級為逐 SKU 猜測。",
      requestId: null,
    });
  }
  const pace = input.pace ?? ((milliseconds) => wait(milliseconds, input.signal));
  for (const sellerSkus of batches) {
    assertNotAborted(input.signal);
    const batchSeeds = sellerSkus.map((sellerSku) => seedBySku.get(sellerSku)!);
    try {
      const readResult = await readVariationRelationshipBatch(adapter, {
        marketplaceId: input.marketplaceId,
        sellerSkus,
        signal: input.signal,
      });
      assertNotAborted(input.signal);
      const result = classifyUnboundVariationSearchBatch({
        marketplaceId: input.marketplaceId,
        seeds: batchSeeds,
        status: readResult.status,
        payload: readResult.envelope,
        requestId: readResult.requestId,
      });
      rows.push(...result.rows);
      verifiedVariationMembers.push(...result.verifiedRows);
      incompleteRows.push(...result.incompleteRows);
      boundChildren += result.boundChildren;
      parentContainers += result.parentContainers;
    } catch (error) {
      assertNotAborted(input.signal);
      const failed = incompleteVariationBatch(
        batchSeeds,
        "RELATIONSHIP_QUERY_FAILED",
        stableRelationshipFailureMessage(error),
        error instanceof SpApiError ? error.requestId : null,
      );
      incompleteRows.push(...failed.incompleteRows);
    }
    await pace(220);
  }
  return {
    mode: "live",
    marketplaceId: input.marketplaceId,
    fetchedAt: (input.now ?? (() => new Date()))().toISOString(),
    rows: rows.sort((left, right) => left.sellerSku.localeCompare(right.sellerSku)),
    incompleteRows: incompleteRows.sort((left, right) =>
      left.sellerSku.localeCompare(right.sellerSku)
    ),
    allVariationRows: buildAllVariationFamilyRows(verifiedVariationMembers),
    summary: {
      totalFbaListings: input.seeds.length,
      completed: input.seeds.length - incompleteRows.length,
      unbound: rows.length,
      boundChildren,
      parentContainers,
      incomplete: incompleteRows.length,
    },
    notice:
      "FBA 範圍取自同次 Amazon 全商品報表；每次以官方 searchListingsItems 最多 20 個 Seller SKU 批次讀取。只有 relationships 明確完整且沒有 parent 的 SKU 才列為未綁變體；缺列、400 相容性或批次錯誤皆另列未完成，不會降級猜測。",
  };
}
