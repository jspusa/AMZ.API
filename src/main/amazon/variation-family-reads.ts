import {
  throwIfAborted as assertNotAborted,
} from "../abort-utils";
import type { MarketplaceId } from "../../shared/marketplaces";
import {
  readListingsItem,
  searchListingsItems,
  type ListingsReadAdapter,
} from "./listings-reads";
import { throwListingsReadError } from "./listings-response-error";
import {
  publicSpApiIssueIdentifier,
  publicSpApiListingIssues,
  publicSpApiRequestId,
  SpApiError,
} from "./sp-api-error";
import {
  applyVariationDimensionNames,
  normalizeVariationMember,
  variationRelationshipEvidenceConflict,
  variationSearchIncludesDeclaredChildren,
  type VariationFamilyMember,
  type VariationFamilySnapshot,
  type VariationListingPayload,
} from "./variation-family";

type VariationReadProfile = "relationships" | "attributes";

export type VariationItemReadResult = {
  payload: VariationListingPayload;
  member: VariationFamilyMember;
  requestId: string | null;
  profile: VariationReadProfile;
};

export type VariationFamilyReadInput = Readonly<{
  marketplaceId: MarketplaceId;
  sellerSku: string;
  signal?: AbortSignal;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isExactSellerSku(value: unknown): value is string {
  return typeof value === "string" &&
    Boolean(value) &&
    value.length <= 256 &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/u.test(
      value,
    );
}

function throwMalformedVariationPayload(requestId: string | null): never {
  throw new SpApiError(
    "Amazon 回傳了無法辨識的變體 Listing 資料。",
    {
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
      requestId,
    },
  );
}

function assertVariationPayloadShape(
  payload: VariationListingPayload,
  requestId: string | null,
): void {
  if (
    payload.attributes !== undefined &&
    !isRecord(payload.attributes)
  ) throwMalformedVariationPayload(requestId);

  for (const [values, validate] of [
    [payload.summaries, (value: Record<string, unknown>) =>
      value.status === undefined ||
      (Array.isArray(value.status) &&
        value.status.every((status) => typeof status === "string"))],
    [payload.productTypes, () => true],
    [payload.fulfillmentAvailability, () => true],
  ] as const) {
    if (
      values !== undefined &&
      (!Array.isArray(values) ||
        values.some((value) => !isRecord(value) || !validate(value)))
    ) throwMalformedVariationPayload(requestId);
  }

  if (payload.relationships !== undefined) {
    if (!Array.isArray(payload.relationships)) {
      throwMalformedVariationPayload(requestId);
    }
    for (const group of payload.relationships) {
      if (!isRecord(group)) throwMalformedVariationPayload(requestId);
      if (group.relationships === undefined) continue;
      if (!Array.isArray(group.relationships)) {
        throwMalformedVariationPayload(requestId);
      }
      for (const relationship of group.relationships) {
        if (!isRecord(relationship)) throwMalformedVariationPayload(requestId);
        for (const field of ["parentSkus", "childSkus"] as const) {
          const values = relationship[field];
          if (
            values !== undefined &&
            (!Array.isArray(values) ||
              values.some((value) => typeof value !== "string"))
          ) throwMalformedVariationPayload(requestId);
        }
        if (relationship.variationTheme !== undefined) {
          if (!isRecord(relationship.variationTheme)) {
            throwMalformedVariationPayload(requestId);
          }
          const attributes = relationship.variationTheme.attributes;
          if (
            attributes !== undefined &&
            (!Array.isArray(attributes) ||
              attributes.some((value) => typeof value !== "string"))
          ) throwMalformedVariationPayload(requestId);
        }
      }
    }
  }

  if (payload.issues !== undefined) {
    if (!Array.isArray(payload.issues)) {
      throwMalformedVariationPayload(requestId);
    }
    for (const issue of payload.issues) {
      if (!isRecord(issue)) throwMalformedVariationPayload(requestId);
      if (
        issue.attributeNames !== undefined &&
        (!Array.isArray(issue.attributeNames) ||
          issue.attributeNames.some((value) => typeof value !== "string"))
      ) throwMalformedVariationPayload(requestId);
    }
  }
}

const PUBLIC_VARIATION_ISSUE_MESSAGE =
  "Amazon 回傳 Listing 提醒；詳細內容請在 Seller Central 核對。";

function sanitizeVariationMember(
  member: VariationFamilyMember,
): VariationFamilyMember {
  const issues = publicSpApiListingIssues(member.issues.map((issue) => ({
    ...issue,
    severity:
      publicSpApiIssueIdentifier(issue.severity.toUpperCase()) ?? "INFO",
    message: PUBLIC_VARIATION_ISSUE_MESSAGE,
  })));
  return {
    ...member,
    issues: issues.map((issue) => ({
      code: issue.code,
      severity: issue.severity,
      message: issue.message,
      attributeNames: [...issue.attributeNames],
    })),
  };
}

function assertExactRelationshipIdentifiers(
  payload: VariationListingPayload,
  marketplaceId: MarketplaceId,
  profile: VariationReadProfile,
  requestId: string | null,
): void {
  if (profile !== "relationships") return;
  if (!Array.isArray(payload.relationships)) {
    throw new SpApiError(
      "Amazon 沒有回傳可精確核對的 relationships 資料集。",
      {
        status: 409,
        code: "VARIATION_RELATIONSHIP_CONFLICT",
        requestId,
      },
    );
  }
  if (payload.relationships.length === 0) return;
  const currentGroups = payload.relationships.filter(
    (group) => group.marketplaceId === marketplaceId,
  );
  if (
    currentGroups.length !== 1 ||
    payload.relationships.some((group) =>
      !isExactSellerSku(group.marketplaceId) ||
      !Array.isArray(group.relationships)
    )
  ) {
    throw new SpApiError(
      "Amazon relationships 的站點群組無法唯一核對目前站點。",
      {
        status: 409,
        code: "VARIATION_RELATIONSHIP_CONFLICT",
        requestId,
      },
    );
  }
  for (const relationship of currentGroups[0]!.relationships ?? []) {
    for (const values of [relationship.parentSkus, relationship.childSkus]) {
      if (values === undefined) continue;
      if (
        !Array.isArray(values) ||
        values.some((value) => !isExactSellerSku(value)) ||
        new Set(values).size !== values.length
      ) {
        throw new SpApiError(
          "Amazon relationships 含有缺失、重複或非原樣的 Seller SKU。",
          {
            status: 409,
            code: "VARIATION_RELATIONSHIP_CONFLICT",
            requestId,
          },
        );
      }
    }
  }
}

function normalizeVariationPayload(
  payload: VariationListingPayload,
  marketplaceId: MarketplaceId,
  fallbackSku: string,
  source: "relationships" | "attributes" | "variationParentSku",
  requestId: string | null,
): VariationFamilyMember {
  const conflict = variationRelationshipEvidenceConflict(payload, marketplaceId);
  if (conflict) {
    throw new SpApiError(conflict, {
      status: 409,
      code: "VARIATION_RELATIONSHIP_CONFLICT",
      requestId,
    });
  }
  const member = normalizeVariationMember(payload, marketplaceId, source);
  return sanitizeVariationMember({
    ...member,
    sellerSku: member.sellerSku || fallbackSku,
  });
}

export async function readVariationItem(
  adapter: ListingsReadAdapter,
  input: VariationFamilyReadInput,
): Promise<VariationItemReadResult> {
  const result = await readListingsItem(adapter, {
    intent: "variation-evidence",
    marketplaceId: input.marketplaceId,
    sellerSku: input.sellerSku,
    signal: input.signal,
  });
  if (result.status < 200 || result.status >= 300) {
    return throwListingsReadError(result, "getListingsItem");
  }
  if (!isRecord(result.envelope)) {
    throw new SpApiError("Amazon 回傳了無法辨識的變體 Listing 資料。", {
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
      requestId: result.requestId,
    });
  }
  const requestId = publicSpApiRequestId(result.requestId);
  const payload = result.envelope as VariationListingPayload;
  if (result.profile !== "relationships" && result.profile !== "attributes") {
    throw new SpApiError("Listings adapter 回傳了不支援的變體讀取 profile。", {
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
      requestId,
    });
  }
  const profile: VariationReadProfile = result.profile;
  assertVariationPayloadShape(payload, requestId);
  assertExactRelationshipIdentifiers(
    payload,
    input.marketplaceId,
    profile,
    requestId,
  );
  return {
    payload,
    member: normalizeVariationPayload(
      payload,
      input.marketplaceId,
      input.sellerSku,
      profile,
      requestId,
    ),
    requestId,
    profile,
  };
}

export async function readVariationChildren(
  adapter: ListingsReadAdapter,
  input: Readonly<{
    marketplaceId: MarketplaceId;
    parentSku: string;
    signal?: AbortSignal;
  }>,
): Promise<{
  rows: Array<{ payload: VariationListingPayload; member: VariationFamilyMember }>;
  requestIds: string[];
  familyComplete: boolean;
  usedCompatibilityFallback: boolean;
}> {
  const rows: Array<{
    payload: VariationListingPayload;
    member: VariationFamilyMember;
  }> = [];
  const requestIds: string[] = [];
  const seenPageTokens = new Set<string>();
  const seenSellerSkus = new Set<string>();
  let pageToken: string | null = null;
  let page = 0;
  let usedCompatibilityFallback = false;
  let resultCountPresence: boolean | null = null;
  let reportedResultCount: number | null = null;

  do {
    assertNotAborted(input.signal);
    const result = await searchListingsItems(adapter, {
      intent: "variation-children",
      marketplaceId: input.marketplaceId,
      parentSku: input.parentSku,
      pageToken,
      signal: input.signal,
    });
    const requestId = publicSpApiRequestId(result.requestId);
    if (result.profile !== "relationships" && result.profile !== "attributes") {
      throw new SpApiError("Listings adapter 回傳了不支援的變體子商品 profile。", {
        status: 502,
        code: "UPSTREAM_UNAVAILABLE",
        requestId,
      });
    }
    const profile: VariationReadProfile = result.profile;
    usedCompatibilityFallback ||= profile === "attributes";
    if (result.status < 200 || result.status >= 300) {
      return throwListingsReadError(result, "searchListingsItems");
    }
    if (requestId) requestIds.push(requestId);
    if (!isRecord(result.envelope) || !Array.isArray(result.envelope.items)) {
      throw new SpApiError("Amazon 回傳了無法辨識的變體子商品清單。", {
        status: 502,
        code: "UPSTREAM_UNAVAILABLE",
        requestId,
      });
    }
    const hasResultCount = result.envelope.numberOfResults !== undefined;
    if (
      resultCountPresence !== null &&
      resultCountPresence !== hasResultCount
    ) {
      throw new SpApiError(
        "Amazon 變體子商品分頁的列數證據前後不一致，已停止使用。",
        { status: 409, code: "PAGINATION_CHANGED", requestId },
      );
    }
    resultCountPresence = hasResultCount;
    if (hasResultCount) {
      const count = result.envelope.numberOfResults;
      if (
        typeof count !== "number" ||
        !Number.isSafeInteger(count) ||
        count < 0 ||
        count > 1_000
      ) {
        throwMalformedVariationPayload(requestId);
      }
      if (reportedResultCount !== null && reportedResultCount !== count) {
        throw new SpApiError(
          "Amazon 變體子商品分頁的總列數在讀取期間改變，已停止使用。",
          { status: 409, code: "PAGINATION_CHANGED", requestId },
        );
      }
      reportedResultCount = count;
    }
    for (const item of result.envelope.items) {
      if (!isRecord(item)) {
        throw new SpApiError("Amazon 變體子商品清單含無法辨識的列。", {
          status: 502,
          code: "UPSTREAM_UNAVAILABLE",
          requestId,
        });
      }
      const payload = item as VariationListingPayload;
      assertVariationPayloadShape(payload, requestId);
      if (!isExactSellerSku(payload.sku)) {
        throw new SpApiError(
          "Amazon 變體子商品搜尋結果缺少可原樣核對的 Seller SKU。",
          {
            status: 409,
            code: "LISTING_IDENTITY_MISMATCH",
            requestId,
          },
        );
      }
      assertExactRelationshipIdentifiers(
        payload,
        input.marketplaceId,
        profile,
        requestId,
      );
      const fallbackSku = payload.sku;
      const member = normalizeVariationPayload(
        payload,
        input.marketplaceId,
        fallbackSku,
        "variationParentSku",
        requestId,
      );
      if (
        member.role !== "child" ||
        member.parentSku !== input.parentSku ||
        !member.sellerSku
      ) {
        throw new SpApiError(
          "Amazon 變體子商品搜尋結果的角色或 parent SKU 與請求不一致，已停止使用。",
          {
            status: 409,
            code: "VARIATION_RELATIONSHIP_CONFLICT",
            requestId,
          },
        );
      }
      if (seenSellerSkus.has(member.sellerSku)) {
        throw new SpApiError(
          "Amazon 變體子商品分頁重複回傳相同 Seller SKU，已停止使用。",
          { status: 409, code: "PAGINATION_CHANGED", requestId },
        );
      }
      seenSellerSkus.add(member.sellerSku);
      rows.push({ payload, member });
    }
    const pagination = result.envelope.pagination;
    if (
      pagination !== undefined &&
      (!isRecord(pagination) ||
        (pagination.nextToken !== undefined &&
          pagination.nextToken !== null &&
          typeof pagination.nextToken !== "string"))
    ) {
      throw new SpApiError("Amazon 變體子商品分頁格式無法辨識。", {
        status: 502,
        code: "UPSTREAM_UNAVAILABLE",
        requestId,
      });
    }
    const rawNextToken = isRecord(pagination) &&
        typeof pagination.nextToken === "string"
      ? pagination.nextToken
      : null;
    if (
      rawNextToken &&
      (rawNextToken !== rawNextToken.trim() ||
        rawNextToken.length > 4_096 ||
        /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/u.test(
          rawNextToken,
        ))
    ) {
      throw new SpApiError(
        "Amazon 變體子商品分頁 token 無法原樣核對，已停止使用。",
        { status: 409, code: "PAGINATION_CHANGED", requestId },
      );
    }
    const nextToken = rawNextToken || null;
    if (nextToken && seenPageTokens.has(nextToken)) {
      throw new SpApiError("Amazon 變體子商品分頁 token 重複，已停止使用。", {
        status: 409,
        code: "PAGINATION_CHANGED",
        requestId,
      });
    }
    if (nextToken) seenPageTokens.add(nextToken);
    pageToken = nextToken;
    page += 1;
  } while (pageToken && page < 10);

  return {
    rows,
    requestIds,
    familyComplete:
      !pageToken &&
      (reportedResultCount === null || reportedResultCount === rows.length),
    usedCompatibilityFallback,
  };
}

export async function readVariationFamily(
  adapter: ListingsReadAdapter,
  input: VariationFamilyReadInput,
): Promise<VariationFamilySnapshot> {
  const queriedResult = await readVariationItem(adapter, input);
  let queried = queriedResult.member;
  if (queried.role === "child" && !queried.parentSku) {
    throw new SpApiError(
      "Amazon 將此 SKU 標示為 child，但沒有回傳可原樣核對的 parent SKU。",
      {
        status: 409,
        code: "VARIATION_RELATIONSHIP_CONFLICT",
        requestId: queriedResult.requestId,
      },
    );
  }
  if (queried.role !== "parent" && !queried.fba) {
    throw new SpApiError(
      "此 SKU 無法確認為 FBA 子商品；變體規劃不會讀取 FBM 商品。",
      {
        status: 422,
        code: "FBA_ONLY",
        requestId: queriedResult.requestId,
      },
    );
  }

  let parentResult: VariationItemReadResult | null = null;
  let parent: VariationFamilyMember | null = null;
  let childrenResult: Awaited<ReturnType<typeof readVariationChildren>> | null = null;
  const parentSku = queried.role === "parent"
    ? queried.sellerSku
    : queried.parentSku;
  if (queried.role === "child" && parentSku) {
    parentResult = await readVariationItem(adapter, {
      marketplaceId: input.marketplaceId,
      sellerSku: parentSku,
      signal: input.signal,
    });
    if (
      parentResult.member.role !== "parent" ||
      parentResult.member.sellerSku !== parentSku ||
      parentResult.member.parentSku !== null
    ) {
      throw new SpApiError(
        "Amazon 回傳的 parent Listing 沒有明確 parent 角色，已停止建立 family。",
        {
          status: 409,
          code: "VARIATION_RELATIONSHIP_CONFLICT",
          requestId: parentResult.requestId,
        },
      );
    }
    parent = parentResult.member;
    if (
      parent.childSkus.length > 0 &&
      !parent.childSkus.includes(queried.sellerSku)
    ) {
      throw new SpApiError(
        "Child 指向的 parent 沒有在 declared children 中回報此 SKU，已停止建立 family。",
        {
          status: 409,
          code: "VARIATION_RELATIONSHIP_CONFLICT",
          requestId: parentResult.requestId,
        },
      );
    }
  } else if (queried.role === "parent") {
    parent = queried;
  }
  if (parentSku) {
    childrenResult = await readVariationChildren(adapter, {
      marketplaceId: input.marketplaceId,
      parentSku,
      signal: input.signal,
    });
  }

  const rawChildren = childrenResult?.rows ?? [];
  const themeEvidence = [
    parent?.variationTheme,
    queried.variationTheme,
    ...rawChildren.map((row) => row.member.variationTheme),
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.trim().toUpperCase());
  if (new Set(themeEvidence).size > 1) {
    throw new SpApiError(
      "Amazon family 成員回傳互相衝突的 variation theme，已停止建立 family。",
      {
        status: 409,
        code: "VARIATION_RELATIONSHIP_CONFLICT",
        requestId: parentResult?.requestId ?? queriedResult.requestId,
      },
    );
  }
  const dimensionContext = [
    ...(parent?.dimensions ?? []),
    ...queried.dimensions,
    ...rawChildren.flatMap((row) => row.member.dimensions),
  ];
  const dimensionNames = [
    ...new Set(dimensionContext.map((dimension) => dimension.name)),
  ];
  const variationTheme =
    parent?.variationTheme ??
    queried.variationTheme ??
    rawChildren.map((row) => row.member.variationTheme).find(Boolean) ??
    null;
  queried = applyVariationDimensionNames(
    queriedResult.payload,
    input.marketplaceId,
    queried,
    variationTheme,
    dimensionNames,
  );
  if (parentResult && parent) {
    parent = applyVariationDimensionNames(
      parentResult.payload,
      input.marketplaceId,
      parent,
      variationTheme,
      dimensionNames,
    );
  } else if (parent?.sellerSku === queried.sellerSku) {
    parent = queried;
  }

  const excludedChildren: VariationFamilySnapshot["excludedChildren"] = [];
  const childMap = new Map<string, VariationFamilyMember>();
  for (const row of rawChildren) {
    const member = applyVariationDimensionNames(
      row.payload,
      input.marketplaceId,
      row.member,
      variationTheme,
      dimensionNames,
    );
    if (!member.fba) {
      excludedChildren.push({
        sellerSku: member.sellerSku,
        reason: "無法確認為 FBA 子商品，純 FBA 規劃已排除。",
      });
    } else {
      childMap.set(member.sellerSku, member);
    }
  }
  if (queried.role === "child" && queried.fba) {
    childMap.set(queried.sellerSku, queried);
  }
  const queriedChildReturnedBySearch =
    queried.role !== "child" ||
    rawChildren.some((row) => row.member.sellerSku === queried.sellerSku);

  const requestIds = [
    queriedResult.requestId,
    parentResult?.requestId,
    ...(childrenResult?.requestIds ?? []),
  ].filter((value): value is string => Boolean(value));
  const compatibilityFallback =
    queriedResult.profile === "attributes" ||
    parentResult?.profile === "attributes" ||
    childrenResult?.usedCompatibilityFallback;
  return {
    mode: "live",
    marketplaceId: input.marketplaceId,
    queriedSku: input.sellerSku,
    queriedRole: queried.role,
    queried,
    parent,
    children: [...childMap.values()].sort((left, right) =>
      left.sellerSku.localeCompare(right.sellerSku)
    ),
    excludedChildren,
    variationTheme,
    dimensionNames,
    familyComplete:
      (childrenResult?.familyComplete ?? true) &&
      queriedChildReturnedBySearch &&
      variationSearchIncludesDeclaredChildren(
        parent,
        rawChildren.map((row) => row.member),
      ),
    fetchedAt: new Date().toISOString(),
    requestIds: [...new Set(requestIds)],
    writable: false,
    boundaries: [
      "Family 快照本身是唯讀資料；只有固定的變體改掛流程可送出 allowlisted PATCH。",
      "既有子商品改掛另一個 parent 需要先移除舊關係再重建，屬於非原子流程。",
      "解除與加入各自都必須重新讀取、Amazon Validation Preview、Notebook 鑰匙（Touch ID／Windows Hello）確認、持久防重送與送出後唯讀回查。",
      "Parent 僅作為不可售的唯讀容器例外；所有可拖移 child 都必須可確認為 FBA。",
    ],
    notice: compatibilityFallback
      ? "Amazon 拒絕 relationships 資料集；目前以 Listing attributes 與 variationParentSku 唯讀結果交叉整理。"
      : "關係取自 Listings Items relationships、attributes 與 variationParentSku 唯讀查詢。",
  };
}

function exactAsin(value: unknown): string | null {
  return typeof value === "string" && /^[A-Z0-9]{10}$/u.test(value)
    ? value
    : null;
}

export function sellerSkuFromAsinSearchPayload(input: {
  marketplaceId: MarketplaceId;
  asin: string;
  payload: unknown;
  requestId?: string | null;
}): string {
  const requestId = input.requestId ?? null;
  if (!exactAsin(input.asin)) {
    throw new SpApiError("ASIN 必須是原樣 10 碼大寫英數字。", {
      status: 400,
      code: "INVALID_INPUT",
      requestId,
    });
  }
  if (!isRecord(input.payload) || !Array.isArray(input.payload.items)) {
    throw new SpApiError("Amazon 回傳了無法辨識的 ASIN Listing 查詢資料。", {
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
      requestId,
    });
  }
  const pagination = input.payload.pagination;
  const numberOfResults = input.payload.numberOfResults;
  if (
    (pagination !== undefined && !isRecord(pagination)) ||
    (numberOfResults !== undefined &&
      (typeof numberOfResults !== "number" ||
        !Number.isSafeInteger(numberOfResults) ||
        numberOfResults < 0))
  ) {
    throw new SpApiError(
      "Amazon ASIN Listing 查詢的分頁或列數格式無法辨識。",
      { status: 502, code: "UPSTREAM_UNAVAILABLE", requestId },
    );
  }
  if (input.payload.items.length === 0) {
    if (
      (typeof numberOfResults === "number" && numberOfResults !== 0) ||
      (isRecord(pagination) && pagination.nextToken)
    ) {
      throw new SpApiError(
        "Amazon ASIN Listing 查詢列數與回傳明細不一致，無法唯一解析 SKU。",
        { status: 502, code: "UPSTREAM_UNAVAILABLE", requestId },
      );
    }
    throw new SpApiError("此 ASIN 找不到這個賣家帳號的 Listing。", {
      status: 404,
      code: "ASIN_NOT_FOUND",
      requestId,
    });
  }
  const sellerSkus: string[] = [];
  for (const value of input.payload.items) {
    if (!isRecord(value) || !Array.isArray(value.summaries)) {
      throw new SpApiError("Amazon ASIN Listing 查詢缺少可核對的 summary。", {
        status: 502,
        code: "UPSTREAM_UNAVAILABLE",
        requestId,
      });
    }
    const exactSummary = value.summaries.find(
      (summary) => isRecord(summary) &&
        summary.marketplaceId === input.marketplaceId &&
        summary.asin === input.asin,
    );
    const sellerSku = typeof value.sku === "string" &&
        Boolean(value.sku) &&
        value.sku.length <= 40 &&
        value.sku === value.sku.trim() &&
        !/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/u.test(
          value.sku,
        )
      ? value.sku
      : null;
    if (!exactSummary || !sellerSku) {
      throw new SpApiError(
        "Amazon ASIN Listing 查詢的 ASIN 或 Seller SKU 無法原樣核對。",
        { status: 502, code: "UPSTREAM_UNAVAILABLE", requestId },
      );
    }
    sellerSkus.push(sellerSku);
  }
  if (new Set(sellerSkus).size !== sellerSkus.length) {
    throw new SpApiError("Amazon ASIN Listing 查詢重複回傳相同 Seller SKU。", {
      status: 502,
      code: "UPSTREAM_UNAVAILABLE",
      requestId,
    });
  }
  if (
    sellerSkus.length > 1 ||
    (typeof numberOfResults === "number" && numberOfResults > 1) ||
    (isRecord(pagination) && Boolean(pagination.nextToken))
  ) {
    throw new SpApiError(
      "此 ASIN 對應多個 Seller SKU；請選擇確切 SKU 後再開啟變體 family。",
      { status: 409, code: "ASIN_AMBIGUOUS", requestId },
    );
  }
  if (numberOfResults !== undefined && numberOfResults !== 1) {
    throw new SpApiError(
      "Amazon ASIN Listing 查詢列數與唯一明細不一致，無法解析 SKU。",
      { status: 502, code: "UPSTREAM_UNAVAILABLE", requestId },
    );
  }
  return sellerSkus[0]!;
}

export async function resolveVariationSellerSkuByAsin(
  adapter: ListingsReadAdapter,
  input: Readonly<{
    marketplaceId: MarketplaceId;
    asin: string;
    signal?: AbortSignal;
  }>,
): Promise<string> {
  const result = await searchListingsItems(adapter, {
    intent: "asin-identity",
    marketplaceId: input.marketplaceId,
    asin: input.asin,
    signal: input.signal,
  });
  if (result.status < 200 || result.status >= 300) {
    return throwListingsReadError(result, "searchListingsItems");
  }
  return sellerSkuFromAsinSearchPayload({
    marketplaceId: input.marketplaceId,
    asin: input.asin,
    payload: result.envelope,
    requestId: result.requestId,
  });
}
