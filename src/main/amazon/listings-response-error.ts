import {
  SpApiError,
  type ListingIssue,
  type SpApiOperation,
} from "./sp-api-error";
import type {
  ListingItemReadResult,
  ListingsSearchReadResult,
  ProductTypeDefinitionReadResult,
} from "./listings-reads";

type ListingsErrorEnvelope = {
  issues?: unknown[];
  errors?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

export function normalizeListingIssues(issues: unknown): ListingIssue[] {
  if (!Array.isArray(issues)) return [];
  return issues.map((rawIssue) => {
    const issue = isRecord(rawIssue) ? rawIssue : {};
    const pluralAttributeNames = Array.isArray(issue.attributeNames)
      ? issue.attributeNames.filter(
        (name): name is string => typeof name === "string" && Boolean(name),
      )
      : [];
    const singularAttributeName = typeof issue.attributeName === "string" &&
        issue.attributeName
      ? [issue.attributeName]
      : [];
    return {
      code: typeof issue.code === "string" ? issue.code : null,
      severity: safeText(issue.severity, "INFO").toUpperCase(),
      message: safeText(issue.message, "Amazon 未提供問題說明。"),
      attributeNames: [...new Set([
        ...pluralAttributeNames,
        ...singularAttributeName,
      ])],
      categories: Array.isArray(issue.categories)
        ? issue.categories.filter(
          (category): category is string =>
            typeof category === "string" && Boolean(category.trim()),
        )
        : [],
      marketplaceIds: Array.isArray(issue.marketplaceIds)
        ? issue.marketplaceIds.filter(
          (marketplaceId): marketplaceId is string =>
            typeof marketplaceId === "string" && Boolean(marketplaceId.trim()),
        )
        : [],
    };
  });
}

function listingErrorMessage(
  status: number,
  operation: "read" | "write",
): { code: string; message: string } {
  if (status === 401 || status === 403) {
    return {
      code: "UNAUTHORIZED",
      message:
        "Amazon 拒絕了這次 Listing 請求，請確認 Product Listing 角色、refresh token 與 Seller ID。",
    };
  }
  if (status === 404) {
    return {
      code: "SKU_NOT_FOUND",
      message: "這個站點找不到該 SKU，請確認大小寫與 Seller SKU 完全一致。",
    };
  }
  if (status === 429) {
    return {
      code: operation === "write" ? "UPDATE_STATUS_UNKNOWN" : "RATE_LIMITED",
      message: operation === "write"
        ? "Amazon 對這次 Listing 寫入回傳限流；系統無法安全證明請求未被處理，請先回查 SKU，不要直接重送。"
        : "Amazon Listings API 正在限流，請稍後再試。",
    };
  }
  if ([400, 413, 415, 422].includes(status)) {
    return {
      code: operation === "write" ? "UPDATE_REJECTED" : "INVALID_LISTING_REQUEST",
      message: operation === "write"
        ? "Amazon 拒絕了這次 Listing 更新，尚未寫入變更。"
        : "Amazon 無法驗證這次 Listing 請求。",
    };
  }
  return {
    code: operation === "write" ? "UPDATE_STATUS_UNKNOWN" : "UPSTREAM_UNAVAILABLE",
    message: operation === "write"
      ? "Amazon 未確認這次 Listing 更新結果。請先重新查詢 SKU，再決定是否重送。"
      : "Amazon Listings API 暫時無法完成查詢。",
  };
}

export function throwListingsPayloadError(input: {
  status: number;
  operation: "read" | "write";
  apiOperation: SpApiOperation;
  requestId: string | null;
  retryAfter: string | null;
  payload: ListingsErrorEnvelope | null;
}): never {
  const fallback = listingErrorMessage(input.status, input.operation);
  const issues = normalizeListingIssues(input.payload?.issues);
  const upstreamError = Array.isArray(input.payload?.errors)
    ? input.payload.errors.find((error) =>
      isRecord(error) &&
      ((typeof error.message === "string" && Boolean(error.message.trim())) ||
        (typeof error.code === "string" && Boolean(error.code.trim())))
    )
    : null;
  const upstreamMessage = isRecord(upstreamError) &&
      typeof upstreamError.message === "string"
    ? upstreamError.message.trim()
    : "";
  const upstreamCode = isRecord(upstreamError) &&
      typeof upstreamError.code === "string"
    ? upstreamError.code.trim() || null
    : null;
  const stageMessage = input.status === 400 && input.operation === "read"
    ? input.apiOperation === "searchListingsItems"
      ? "Amazon 無法驗證 Listings 搜尋／連線請求。"
      : input.apiOperation === "getDefinitionsProductType"
        ? "Amazon 無法驗證 Product Type Definitions 商品欄位規格請求。"
        : input.apiOperation === "getListingsItem"
          ? "Amazon 無法驗證 getListingsItem 商品查詢。"
          : fallback.message
    : fallback.message;

  throw new SpApiError(
    upstreamMessage ? `${stageMessage}（${upstreamMessage}）` : stageMessage,
    {
      status: input.status,
      code: fallback.code,
      requestId: input.requestId,
      retryAfter: input.retryAfter,
      issues,
      operation: input.apiOperation,
      upstreamCode,
    },
  );
}

export function throwListingsReadError(
  result:
    | ListingItemReadResult
    | ListingsSearchReadResult
    | ProductTypeDefinitionReadResult,
  apiOperation: Extract<
    SpApiOperation,
    "getListingsItem" | "searchListingsItems" | "getDefinitionsProductType"
  >,
): never {
  const payload = isRecord(result.envelope)
    ? result.envelope as ListingsErrorEnvelope
    : null;
  return throwListingsPayloadError({
    status: result.status,
    operation: "read",
    apiOperation,
    requestId: result.requestId,
    retryAfter: result.retryAfter,
    payload,
  });
}
