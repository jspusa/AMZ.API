export type ReviewAuditRankedItemView = {
  sellerSkus: string[];
  asin: string;
  title: string;
  topic: string;
  numberOfMentions: number;
  occurrencePercentage: number;
  starRatingImpact: number;
  metricLabel: "NON_PARENT_ASIN_TOPIC_STAR_RATING_IMPACT";
};

export type ReviewTopicView = {
  topic: string;
  numberOfMentions: number;
  occurrencePercentage: number;
  starRatingImpact: number;
  reviewSnippets: string[];
};

export type ReviewAuditRowView = {
  sellerSkus: string[];
  asin: string;
  title: string;
  relationshipRole: "child" | "standalone";
  status: "COMPLETE" | "NO_TOPICS" | "INCOMPLETE";
  positiveTopics: ReviewTopicView[];
  negativeTopics: ReviewTopicView[];
  incompleteReason: null | { code: string; message: string; requestId: string | null };
  averageProductRating: null;
  totalReviewCount: null;
  fullReviewTextAvailable: false;
};

export type ReviewAuditSnapshotView = {
  schemaVersion: 2;
  mode: "live" | "demo";
  marketplaceId: string;
  fetchedAt: string;
  exportId: string;
  rows: ReviewAuditRowView[];
  relationshipIncompleteRows: Array<{
    sellerSku: string;
    asin: string;
    title: string;
    code: string;
    message: string;
    requestId: string | null;
  }>;
  topFivePositive: ReviewAuditRankedItemView[];
  bottomFiveNegative: ReviewAuditRankedItemView[];
  summary: {
    sourceFbaListings: number;
    verifiedNonParentListings: number;
    uniqueFbaNonParentAsins: number;
    verifiedChildListings: number;
    verifiedStandaloneListings: number;
    excludedParentContainers: number;
    relationshipIncomplete: number;
    completed: number;
    noTopics: number;
    feedbackIncomplete: number;
    totalIncomplete: number;
    incomplete: number;
    duplicateSkuAsinsCollapsed: number;
  };
  notice: string;
};

export type ReviewAuditJobView = {
  jobId: string;
  marketplaceId: string;
  mode: "live" | "demo";
  ready: false;
  status: string;
  progress: { completed: number; total: number | null; percent: number };
  message: string;
  capabilityNotice: string;
};

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}格式無效。`);
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, maximum = 5_000): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error(`${label}無效。`);
  return value;
}
function integer(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`${label}無效。`);
  return value;
}
function finite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label}無效。`);
  return value;
}
function identifier(value: unknown, label: string): string {
  const result = text(value, label, 200);
  if (!/^[A-Za-z0-9._-]+$/u.test(result)) throw new Error(`${label}無效。`);
  return result;
}
function skus(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) throw new Error("Seller SKU 清單無效。");
  return value.map((sku) => text(sku, "Seller SKU", 40));
}

function topic(value: unknown) {
  const raw = record(value, "評論主題");
  if (!Array.isArray(raw.reviewSnippets) || raw.reviewSnippets.length > 20) throw new Error("評論短句無效。");
  return {
    topic: text(raw.topic, "主題", 300),
    numberOfMentions: integer(raw.numberOfMentions, "提及數"),
    occurrencePercentage: finite(raw.occurrencePercentage, "出現比例"),
    starRatingImpact: finite(raw.starRatingImpact, "主題星等影響"),
    reviewSnippets: raw.reviewSnippets.map((snippet) => text(snippet, "評論短句", 1_000)),
  };
}

function ranked(value: unknown): ReviewAuditRankedItemView {
  const raw = record(value, "評論主題排名");
  if (raw.metricLabel !== "NON_PARENT_ASIN_TOPIC_STAR_RATING_IMPACT") throw new Error("評論排名指標無效。");
  return {
    sellerSkus: skus(raw.sellerSkus),
    asin: text(raw.asin, "ASIN", 10),
    title: text(raw.title, "商品名稱"),
    topic: text(raw.topic, "主題", 300),
    numberOfMentions: integer(raw.numberOfMentions, "提及數"),
    occurrencePercentage: finite(raw.occurrencePercentage, "出現比例"),
    starRatingImpact: finite(raw.starRatingImpact, "主題星等影響"),
    metricLabel: "NON_PARENT_ASIN_TOPIC_STAR_RATING_IMPACT",
  };
}

export function parseReviewAuditSnapshot(value: unknown, expectedMarketplaceId: string): ReviewAuditSnapshotView {
  const raw = record(value, "評論健檢回應");
  if (raw.schemaVersion !== 2 || raw.marketplaceId !== expectedMarketplaceId) throw new Error("評論健檢版本或站點不一致。");
  if (!Array.isArray(raw.rows) || !Array.isArray(raw.relationshipIncompleteRows) || !Array.isArray(raw.topFivePositive) || !Array.isArray(raw.bottomFiveNegative)) throw new Error("評論健檢缺少關係覆蓋、排名或明細。");
  const rows: ReviewAuditRowView[] = raw.rows.map((value) => {
    const row = record(value, "評論健檢列");
    if (!Array.isArray(row.positiveTopics) || !Array.isArray(row.negativeTopics)) throw new Error("評論主題清單無效。");
    if (row.averageProductRating !== null || row.totalReviewCount !== null || row.fullReviewTextAvailable !== false) throw new Error("評論健檢含公開 API 未提供的指標。");
    const status = row.status;
    if (status !== "COMPLETE" && status !== "NO_TOPICS" && status !== "INCOMPLETE") throw new Error("評論健檢狀態無效。");
    const relationshipRole = row.relationshipRole;
    if (relationshipRole !== "child" && relationshipRole !== "standalone") throw new Error("評論健檢關係角色無效。");
    const reason = row.incompleteReason === null ? null : record(row.incompleteReason, "未完成原因");
    return {
      sellerSkus: skus(row.sellerSkus),
      asin: text(row.asin, "ASIN", 10),
      title: text(row.title, "商品名稱"),
      relationshipRole,
      status,
      positiveTopics: row.positiveTopics.map(topic),
      negativeTopics: row.negativeTopics.map(topic),
      incompleteReason: reason ? {
        code: text(reason.code, "未完成代碼", 120),
        message: text(reason.message, "未完成說明"),
        requestId: reason.requestId === null ? null : text(reason.requestId, "request ID", 200),
      } : null,
      averageProductRating: null,
      totalReviewCount: null,
      fullReviewTextAvailable: false,
    };
  });
  const relationshipIncompleteRows = raw.relationshipIncompleteRows.map((value) => {
    const row = record(value, "關係證據未完成列");
    return {
      sellerSku: text(row.sellerSku, "Seller SKU", 40),
      asin: typeof row.asin === "string" && row.asin === row.asin.trim() &&
          row.asin.length <= 40 && !/[\u0000-\u001f\u007f]/u.test(row.asin)
        ? row.asin
        : (() => { throw new Error("關係證據 ASIN 無效。"); })(),
      title: text(row.title, "商品名稱"),
      code: text(row.code, "關係證據未完成代碼", 120),
      message: text(row.message, "關係證據未完成說明"),
      requestId: row.requestId === null ? null : text(row.requestId, "request ID", 200),
    };
  });
  const verifiedSellerSkus = new Set<string>();
  const verifiedAsins = new Set<string>();
  for (const row of rows) {
    if (!/^[A-Z0-9]{10}$/u.test(row.asin) || verifiedAsins.has(row.asin)) {
      throw new Error("非 parent ASIN 缺少、重複或格式無效。");
    }
    verifiedAsins.add(row.asin);
    if (
      (row.status === "INCOMPLETE") !== Boolean(row.incompleteReason) ||
      row.sellerSkus.some((sellerSku) => {
        if (verifiedSellerSkus.has(sellerSku)) return true;
        verifiedSellerSkus.add(sellerSku);
        return false;
      })
    ) {
      throw new Error("評論健檢列的狀態或 Seller SKU 覆蓋不一致。");
    }
  }
  const relationshipSellerSkus = new Set<string>();
  for (const row of relationshipIncompleteRows) {
    if (
      verifiedSellerSkus.has(row.sellerSku) ||
      relationshipSellerSkus.has(row.sellerSku)
    ) {
      throw new Error("關係證據未完成列與已驗證 SKU 重疊。");
    }
    relationshipSellerSkus.add(row.sellerSku);
  }
  const summaryRaw = record(raw.summary, "評論健檢摘要");
  const summary = {
    sourceFbaListings: integer(summaryRaw.sourceFbaListings, "FBA 來源數"),
    verifiedNonParentListings: integer(summaryRaw.verifiedNonParentListings, "已驗證非 parent SKU 數"),
    uniqueFbaNonParentAsins: integer(summaryRaw.uniqueFbaNonParentAsins, "唯一非 parent ASIN 數"),
    verifiedChildListings: integer(summaryRaw.verifiedChildListings, "已驗證 child SKU 數"),
    verifiedStandaloneListings: integer(summaryRaw.verifiedStandaloneListings, "已驗證 standalone SKU 數"),
    excludedParentContainers: integer(summaryRaw.excludedParentContainers, "已排除 parent 數"),
    relationshipIncomplete: integer(summaryRaw.relationshipIncomplete, "關係證據未完成數"),
    completed: integer(summaryRaw.completed, "完成數"),
    noTopics: integer(summaryRaw.noTopics, "無主題數"),
    feedbackIncomplete: integer(summaryRaw.feedbackIncomplete, "評論查詢未完成數"),
    totalIncomplete: integer(summaryRaw.totalIncomplete, "總未完成數"),
    incomplete: integer(summaryRaw.incomplete, "未完成數"),
    duplicateSkuAsinsCollapsed: integer(summaryRaw.duplicateSkuAsinsCollapsed, "合併數"),
  };
  if (
    summary.uniqueFbaNonParentAsins !== rows.length ||
    summary.verifiedNonParentListings !==
      summary.verifiedChildListings + summary.verifiedStandaloneListings ||
    summary.sourceFbaListings !==
      summary.verifiedNonParentListings +
        summary.excludedParentContainers + summary.relationshipIncomplete ||
    summary.relationshipIncomplete !== relationshipIncompleteRows.length ||
    summary.verifiedNonParentListings !== verifiedSellerSkus.size ||
    summary.completed + summary.noTopics + summary.feedbackIncomplete !== rows.length ||
    summary.totalIncomplete !==
      summary.feedbackIncomplete + summary.relationshipIncomplete ||
    summary.incomplete !== summary.totalIncomplete ||
    summary.duplicateSkuAsinsCollapsed !==
      summary.verifiedNonParentListings - rows.length
  ) throw new Error("評論健檢摘要與關係覆蓋或明細不一致。");
  const fetchedAt = text(raw.fetchedAt, "評論健檢時間", 64);
  if (Number.isNaN(new Date(fetchedAt).getTime())) throw new Error("評論健檢時間無效。");
  return {
    schemaVersion: 2,
    mode: raw.mode === "live" ? "live" : raw.mode === "demo" ? "demo" : (() => { throw new Error("評論健檢模式無效。"); })(),
    marketplaceId: expectedMarketplaceId,
    fetchedAt,
    exportId: identifier(raw.exportId, "評論健檢匯出 ID"),
    rows,
    relationshipIncompleteRows,
    topFivePositive: raw.topFivePositive.map(ranked).map((item) => {
      if (!verifiedAsins.has(item.asin)) throw new Error("正向排名引用不明 ASIN。");
      return item;
    }),
    bottomFiveNegative: raw.bottomFiveNegative.map(ranked).map((item) => {
      if (!verifiedAsins.has(item.asin)) throw new Error("負向排名引用不明 ASIN。");
      return item;
    }),
    summary,
    notice: text(raw.notice, "評論健檢說明"),
  };
}

export function parseReviewAuditJob(value: unknown, expectedMarketplaceId: string): ReviewAuditJobView {
  const raw = record(value, "評論健檢工作");
  if (raw.ready !== false || raw.marketplaceId !== expectedMarketplaceId) throw new Error("評論健檢工作與目前站點不一致。");
  const progress = record(raw.progress, "評論健檢進度");
  const total = progress.total === null ? null : integer(progress.total, "評論總數");
  return {
    jobId: identifier(raw.jobId, "評論健檢工作 ID"),
    marketplaceId: expectedMarketplaceId,
    mode: raw.mode === "live" ? "live" : raw.mode === "demo" ? "demo" : (() => { throw new Error("評論健檢模式無效。"); })(),
    ready: false,
    status: text(raw.status, "評論健檢狀態", 120),
    progress: {
      completed: integer(progress.completed, "已完成數"),
      total,
      percent: integer(progress.percent, "完成比例"),
    },
    message: text(raw.message, "評論健檢說明"),
    capabilityNotice: text(raw.capabilityNotice, "評論 API 邊界"),
  };
}
