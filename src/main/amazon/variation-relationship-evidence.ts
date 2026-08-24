import {
  throwIfAborted as assertNotAborted,
} from "../abort-utils";
import type { MarketplaceId } from "../../shared/marketplaces";
import { planExactSellerSkuBatches } from "./exact-seller-sku-batches";
import {
  exactListingEnvelopeIdentity,
  searchListingsItems,
  type ListingsReadAdapter,
} from "./listings-reads";
import {
  publicSpApiRequestId,
  SpApiError,
} from "./sp-api-error";
import {
  normalizeVariationMember,
  variationRelationshipEvidenceConflict,
  type VariationListingPayload,
} from "./variation-family";
import {
  classifyUnboundVariationEvidence,
} from "./unbound-variation-audit";

export type UnboundVariationSearchSeed = Readonly<{
  sellerSku: string;
  asin: string;
  title: string;
}>;

export type VerifiedFbaVariationRelationshipRow = {
  sellerSku: string;
  asin: string;
  title: string;
  productType: string;
  role: "parent" | "child" | "standalone";
  parentSku: string | null;
  variationTheme: string | null;
  relationshipEvidence: "relationships";
  requestId: string | null;
};

export type UnboundVariationAuditRow = {
  sellerSku: string;
  asin: string;
  title: string;
  productType: string;
  relationshipEvidence: "relationships";
  notice: string;
};

export type UnboundVariationAuditIncompleteRow = {
  sellerSku: string;
  asin: string;
  title: string;
  code:
    | "RELATIONSHIPS_NOT_RETURNED"
    | "RELATIONSHIPS_COMPATIBILITY_FALLBACK"
    | "RELATIONSHIP_QUERY_FAILED"
    | "RELATIONSHIP_RESPONSE_INVALID"
    | "FULFILLMENT_EVIDENCE_CONFLICT";
  message: string;
  requestId: string | null;
};

export type UnboundVariationSearchBatchResult = {
  verifiedRows: VerifiedFbaVariationRelationshipRow[];
  rows: UnboundVariationAuditRow[];
  incompleteRows: UnboundVariationAuditIncompleteRow[];
  boundChildren: number;
  parentContainers: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function buildUnboundVariationSearchBatches(
  sellerSkus: readonly string[],
): { batches: string[][]; unqueryableSellerSkus: string[] } {
  try {
    return planExactSellerSkuBatches(sellerSkus);
  } catch (error) {
    if (error instanceof SpApiError && error.code === "PAGINATION_CHANGED") {
      throw new SpApiError("未綁變體批次含有重複 Seller SKU。", {
        status: error.status,
        code: error.code,
      });
    }
    throw error;
  }
}

export async function readVariationRelationshipBatch(
  adapter: Pick<ListingsReadAdapter, "searchItems">,
  input: Readonly<{
    marketplaceId: MarketplaceId;
    sellerSkus: readonly string[];
    signal?: AbortSignal;
  }>,
) {
  assertNotAborted(input.signal);
  const result = await searchListingsItems(adapter, {
    intent: "variation-sku-batch",
    marketplaceId: input.marketplaceId,
    sellerSkus: input.sellerSkus,
    signal: input.signal,
  });
  if (result.profile !== "variation") {
    throw new SpApiError(
      "Listings adapter 回傳了不支援的變體批次 profile。",
      {
        status: 502,
        code: "UPSTREAM_UNAVAILABLE",
        requestId: publicSpApiRequestId(result.requestId),
      },
    );
  }
  return result;
}

export function incompleteVariationBatch(
  seeds: readonly UnboundVariationSearchSeed[],
  code: UnboundVariationAuditIncompleteRow["code"],
  message: string,
  requestId: string | null,
): UnboundVariationSearchBatchResult {
  return {
    verifiedRows: [],
    rows: [],
    incompleteRows: seeds.map((seed) => ({
      sellerSku: seed.sellerSku,
      asin: seed.asin,
      title: seed.title,
      code,
      message,
      requestId: publicSpApiRequestId(requestId),
    })),
    boundChildren: 0,
    parentContainers: 0,
  };
}

type VariationMarketplaceSummary = NonNullable<
  VariationListingPayload["summaries"]
>[number];

function exactVariationMarketplaceSummary(input: {
  payload: VariationListingPayload;
  marketplaceId: MarketplaceId;
}):
  | { summary: VariationMarketplaceSummary; error: null }
  | { summary: null; error: string } {
  if (input.payload.summaries === undefined) {
    return {
      summary: null,
      error: "Amazon summaries 沒有回傳目前站點的 ASIN 證據。",
    };
  }
  if (!Array.isArray(input.payload.summaries)) {
    return {
      summary: null,
      error: "Amazon summaries 格式無法辨識，無法精確核對目前站點。",
    };
  }
  const summaries: VariationMarketplaceSummary[] = [];
  for (const value of input.payload.summaries) {
    if (
      !isRecord(value) ||
      typeof value.marketplaceId !== "string" ||
      !value.marketplaceId ||
      value.marketplaceId !== value.marketplaceId.trim() ||
      /[\u0000-\u001f\u007f]/u.test(value.marketplaceId) ||
      typeof value.asin !== "string" ||
      !/^[A-Z0-9]{10}$/u.test(value.asin)
    ) {
      return {
        summary: null,
        error:
          "Amazon summaries 含有站點不明或格式不完整的列，無法唯一辨識目前站點。",
      };
    }
    summaries.push(value as VariationMarketplaceSummary);
  }
  const current = summaries.filter(
    (summary) => summary.marketplaceId === input.marketplaceId,
  );
  if (current.length !== 1) {
    return {
      summary: null,
      error: current.length === 0
        ? "Amazon summaries 沒有回傳目前站點的唯一 summary；其他站點資料不會被當成本站資料。"
        : "Amazon summaries 同時回傳多個目前站點 summary，無法唯一辨識本站資料。",
    };
  }
  return { summary: current[0]!, error: null };
}

function payloadFulfillmentEvidence(
  payload: VariationListingPayload,
): "FBA" | "OTHER" | "MISSING" {
  const availability = Array.isArray(payload.fulfillmentAvailability)
    ? payload.fulfillmentAvailability
    : [];
  const channelCodes = availability
    .map((entry) => typeof entry.fulfillmentChannelCode === "string"
      ? entry.fulfillmentChannelCode.trim()
      : "")
    .filter(Boolean);
  if (
    channelCodes.some((channelCode) =>
      /^(AMAZON|AFN)(?:_|$)/i.test(channelCode)
    )
  ) return "FBA";
  return channelCodes.length ? "OTHER" : "MISSING";
}

function exactRelationshipVariationTheme(
  payload: VariationListingPayload,
  marketplaceId: MarketplaceId,
): string | null {
  if (!Array.isArray(payload.relationships)) return null;
  const themes: string[] = [];
  for (const group of payload.relationships) {
    if (!isRecord(group) || group.marketplaceId !== marketplaceId) continue;
    if (!Array.isArray(group.relationships)) continue;
    for (const relationship of group.relationships) {
      if (!isRecord(relationship) || !isRecord(relationship.variationTheme)) {
        continue;
      }
      const theme = relationship.variationTheme.theme;
      if (typeof theme === "string" && theme.trim()) themes.push(theme.trim());
    }
  }
  return [...new Set(themes.map((theme) => theme.toUpperCase()))].length === 1
    ? themes[0]!
    : null;
}

export function classifyUnboundVariationSearchBatch(input: {
  marketplaceId: MarketplaceId;
  seeds: readonly UnboundVariationSearchSeed[];
  status: number;
  payload: unknown;
  requestId: string | null;
}): UnboundVariationSearchBatchResult {
  const requestId = publicSpApiRequestId(input.requestId);
  if (input.status === 400) {
    return incompleteVariationBatch(
      input.seeds,
      "RELATIONSHIPS_COMPATIBILITY_FALLBACK",
      "Amazon 拒絕官方 searchListingsItems relationships 批次參數；本次未降級為逐 SKU 或 attributes 猜測。",
      requestId,
    );
  }
  if (input.status < 200 || input.status >= 300) {
    return incompleteVariationBatch(
      input.seeds,
      "RELATIONSHIP_QUERY_FAILED",
      `Amazon relationships 批次查詢失敗（HTTP ${input.status}）；此批次未作任何推定。`,
      requestId,
    );
  }
  if (!isRecord(input.payload) || !Array.isArray(input.payload.items)) {
    return incompleteVariationBatch(
      input.seeds,
      "RELATIONSHIP_RESPONSE_INVALID",
      "Amazon relationships 批次回應格式無法辨識；此批次未作任何推定。",
      requestId,
    );
  }
  const pagination = input.payload.pagination;
  const numberOfResults = input.payload.numberOfResults;
  if (
    (pagination !== undefined &&
      (!isRecord(pagination) ||
        (pagination.nextToken !== undefined &&
          pagination.nextToken !== null && pagination.nextToken !== ""))) ||
    (numberOfResults !== undefined &&
      (!Number.isSafeInteger(numberOfResults) ||
        numberOfResults !== input.payload.items.length))
  ) {
    return incompleteVariationBatch(
      input.seeds,
      "RELATIONSHIP_RESPONSE_INVALID",
      "Amazon relationships 批次回應顯示仍有未讀頁面或列數不一致；此批次未作任何推定。",
      requestId,
    );
  }
  const seedBySku = new Map(input.seeds.map((seed) => [seed.sellerSku, seed]));
  if (seedBySku.size !== input.seeds.length) {
    return incompleteVariationBatch(
      input.seeds,
      "RELATIONSHIP_RESPONSE_INVALID",
      "未綁變體批次含有重複 Seller SKU；此批次已停止判定。",
      requestId,
    );
  }
  const itemBySku = new Map<string, VariationListingPayload>();
  for (const value of input.payload.items) {
    if (!isRecord(value)) {
      return incompleteVariationBatch(
        input.seeds,
        "RELATIONSHIP_RESPONSE_INVALID",
        "Amazon relationships 批次回應含有無法辨識的 Listing 列；此批次未作任何推定。",
        requestId,
      );
    }
    const sellerSku = typeof value.sku === "string" &&
        Boolean(value.sku) &&
        value.sku.length <= 40 &&
        value.sku === value.sku.trim() &&
        !/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/u.test(
          value.sku,
        )
      ? value.sku
      : null;
    if (!sellerSku || !seedBySku.has(sellerSku) || itemBySku.has(sellerSku)) {
      return incompleteVariationBatch(
        input.seeds,
        "RELATIONSHIP_RESPONSE_INVALID",
        "Amazon relationships 批次回應的 Seller SKU 缺少、重複或與請求不一致；此批次未作任何推定。",
        requestId,
      );
    }
    itemBySku.set(sellerSku, value as VariationListingPayload);
  }

  const verifiedRows: VerifiedFbaVariationRelationshipRow[] = [];
  const rows: UnboundVariationAuditRow[] = [];
  const incompleteRows: UnboundVariationAuditIncompleteRow[] = [];
  let boundChildren = 0;
  let parentContainers = 0;
  for (const seed of input.seeds) {
    const payload = itemBySku.get(seed.sellerSku);
    if (!payload) {
      incompleteRows.push({
        sellerSku: seed.sellerSku,
        asin: seed.asin,
        title: seed.title,
        code: "RELATIONSHIPS_NOT_RETURNED",
        message:
          "Amazon searchListingsItems 未回傳此報表 SKU；缺列不會被視為 standalone。",
        requestId,
      });
      continue;
    }
    try {
      const summarySelection = exactVariationMarketplaceSummary({
        payload,
        marketplaceId: input.marketplaceId,
      });
      if (summarySelection.summary === null) {
        incompleteRows.push({
          sellerSku: seed.sellerSku,
          asin: seed.asin,
          title: seed.title,
          code: "RELATIONSHIP_RESPONSE_INVALID",
          message: summarySelection.error,
          requestId,
        });
        continue;
      }
      const liveAsin = summarySelection.summary.asin!;
      if (!/^[A-Z0-9]{10}$/u.test(seed.asin) || liveAsin !== seed.asin) {
        incompleteRows.push({
          sellerSku: seed.sellerSku,
          asin: seed.asin,
          title: seed.title,
          code: "RELATIONSHIP_RESPONSE_INVALID",
          message:
            "Amazon summaries 回傳的 ASIN 與同次 FBA 報表不一致；已停止判定，不會用任一方覆蓋或冒充。",
          requestId,
        });
        continue;
      }
      if (!exactListingEnvelopeIdentity(
        payload,
        input.marketplaceId,
        seed.sellerSku,
        seed.asin,
      )) {
        incompleteRows.push({
          sellerSku: seed.sellerSku,
          asin: seed.asin,
          title: seed.title,
          code: "RELATIONSHIP_RESPONSE_INVALID",
          message:
            "Amazon relationships 回應的 Seller SKU、Product Type 或站點身分不完整。",
          requestId,
        });
        continue;
      }
      const conflict = variationRelationshipEvidenceConflict(
        payload,
        input.marketplaceId,
      );
      if (conflict) {
        incompleteRows.push({
          sellerSku: seed.sellerSku,
          asin: seed.asin,
          title: seed.title,
          code: "RELATIONSHIP_RESPONSE_INVALID",
          message: conflict,
          requestId,
        });
        continue;
      }
      const member = normalizeVariationMember(
        payload,
        input.marketplaceId,
        "relationships",
      );
      if (member.sellerSku !== seed.sellerSku) {
        incompleteRows.push({
          sellerSku: seed.sellerSku,
          asin: seed.asin,
          title: seed.title,
          code: "RELATIONSHIP_RESPONSE_INVALID",
          message: "Amazon relationships 回應的 Seller SKU 與報表不一致。",
          requestId,
        });
        continue;
      }
      const classification = classifyUnboundVariationEvidence({
        marketplaceId: input.marketplaceId,
        profile: "relationships",
        relationships: payload.relationships,
        role: member.role,
        listingFulfillmentEvidence: payloadFulfillmentEvidence(payload),
      });
      const verified: VerifiedFbaVariationRelationshipRow = {
        sellerSku: seed.sellerSku,
        asin: liveAsin,
        title: member.title || seed.title || "Amazon 未提供商品名稱",
        productType: member.productType,
        role: member.role,
        parentSku: member.parentSku,
        variationTheme: exactRelationshipVariationTheme(
          payload,
          input.marketplaceId,
        ),
        relationshipEvidence: "relationships",
        requestId,
      };
      if (classification.kind === "unbound") {
        verifiedRows.push(verified);
        rows.push({
          sellerSku: seed.sellerSku,
          asin: verified.asin,
          title: verified.title,
          productType: member.productType,
          relationshipEvidence: "relationships",
          notice: "Amazon relationships 已完整回傳，且沒有 parent 關係。",
        });
      } else if (classification.kind === "bound-child") {
        verifiedRows.push(verified);
        boundChildren += 1;
      } else if (classification.kind === "parent-container") {
        verifiedRows.push(verified);
        parentContainers += 1;
      } else {
        incompleteRows.push({
          sellerSku: seed.sellerSku,
          asin: member.asin ?? seed.asin,
          title: member.title || seed.title,
          code: classification.code,
          message: classification.message,
          requestId,
        });
      }
    } catch (error) {
      incompleteRows.push({
        sellerSku: seed.sellerSku,
        asin: seed.asin,
        title: seed.title,
        code: "RELATIONSHIP_RESPONSE_INVALID",
        message: error instanceof SpApiError
          ? "Amazon relationships 回應的身分或角色證據互相衝突。"
          : "Amazon relationships 回應無法安全判定。",
        requestId,
      });
    }
  }
  return { verifiedRows, rows, incompleteRows, boundChildren, parentContainers };
}
