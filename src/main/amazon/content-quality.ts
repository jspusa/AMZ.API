export type ContentQualityIssueKind =
  | "MISSING_BULLETS"
  | "MISSING_INGREDIENTS"
  | "INGREDIENTS_UNVERIFIED"
  | "SUSPECTED_TYPO";

export type ContentQualityField = "title" | "bulletPoints" | "ingredients";

export type ContentQualityIssue = {
  kind: ContentQualityIssueKind;
  field: ContentQualityField;
  message: string;
  token?: string;
  suggestion?: string;
};

export type ContentQualityReadError = {
  code: "LISTING_QUERY_FAILED" | "LISTING_CONTENT_NOT_RETURNED";
  message: string;
};

export type ContentQualitySourceRow = {
  sellerSku: string;
  asin: string;
  productType: string;
  title: string;
  bulletPoints: string[];
  ingredients: string;
  readStatus: "complete" | "incomplete";
  readErrors: ContentQualityReadError[];
};

export type ContentQualityRow = ContentQualitySourceRow & {
  issues: ContentQualityIssue[];
};

export type ContentQualitySummary = {
  total: number;
  completed: number;
  incomplete: number;
  withIssues: number;
  suspectedTypos: number;
  missingBullets: number;
  missingIngredients: number;
  ingredientsUnverified: number;
};

export type ContentQualityAudit = {
  marketplaceId: string;
  fetchedAt: string;
  rows: ContentQualityRow[];
  readErrors: Array<ContentQualityReadError & { sellerSku: string }>;
  summary: ContentQualitySummary;
};

type KnownTypo = {
  pattern: RegExp;
  suggestion: string;
};

const KNOWN_TYPOS: readonly KnownTypo[] = [
  { pattern: /\bcocount\b/giu, suggestion: "coconut" },
  { pattern: /\bprotien\b/giu, suggestion: "protein" },
  { pattern: /\bingrediants\b/giu, suggestion: "ingredients" },
  { pattern: /\bartifical\b/giu, suggestion: "artificial" },
  { pattern: /\bnutriton\b/giu, suggestion: "nutrition" },
];

const INVISIBLE_CHARACTER = /[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/gu;
const REPEATED_WORD = /\b([A-Za-z][A-Za-z'-]*)\s+\1\b/giu;

function suggestionWithCase(token: string, suggestion: string): string {
  if (token === token.toUpperCase()) return suggestion.toUpperCase();
  if (token[0] === token[0]?.toUpperCase()) {
    return `${suggestion[0]?.toUpperCase() ?? ""}${suggestion.slice(1)}`;
  }
  return suggestion;
}

function typoIssues(
  value: string,
  field: ContentQualityField,
): ContentQualityIssue[] {
  const issues: ContentQualityIssue[] = [];

  for (const rule of KNOWN_TYPOS) {
    for (const match of value.matchAll(rule.pattern)) {
      const token = match[0];
      issues.push({
        kind: "SUSPECTED_TYPO",
        field,
        message: `發現明確的常見拼字「${token}」，請人工確認。`,
        token,
        suggestion: suggestionWithCase(token, rule.suggestion),
      });
    }
  }

  for (const match of value.matchAll(REPEATED_WORD)) {
    const token = match[0];
    const suggestion = match[1];
    issues.push({
      kind: "SUSPECTED_TYPO",
      field,
      message: `發現連續重複單字「${token}」，請人工確認。`,
      token,
      suggestion,
    });
  }

  const invisibleCodePoints = new Set(
    [...value.matchAll(INVISIBLE_CHARACTER)].map((match) =>
      `U+${(match[0].codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`,
    ),
  );
  for (const codePoint of invisibleCodePoints) {
    issues.push({
      kind: "SUSPECTED_TYPO",
      field,
      message: `發現不可見字元 ${codePoint}，可能是複製貼上造成，請人工確認。`,
      token: codePoint,
      suggestion: "移除不可見字元",
    });
  }

  return issues;
}

function auditRow(source: ContentQualitySourceRow): ContentQualityRow {
  const bulletPoints = [...source.bulletPoints];
  const readErrors = source.readErrors.map((error) => ({ ...error }));
  if (source.readStatus !== "complete") {
    return {
      ...source,
      bulletPoints,
      readStatus: "incomplete",
      readErrors,
      issues: [],
    };
  }
  const nonEmptyBulletCount = bulletPoints.filter((value) => value.trim()).length;
  const issues: ContentQualityIssue[] = [];

  if (nonEmptyBulletCount < 5) {
    issues.push({
      kind: "MISSING_BULLETS",
      field: "bulletPoints",
      message: `目前只有 ${nonEmptyBulletCount} 個非空白賣點，少於 5 個。`,
    });
  }
  if (!source.ingredients.trim()) {
    if (source.productType.trim().toUpperCase() === "PET_FOOD") {
      issues.push({
        kind: "MISSING_INGREDIENTS",
        field: "ingredients",
        message: "PET_FOOD 商品目前沒有可讀取的成分內容。",
      });
    } else {
      issues.push({
        kind: "INGREDIENTS_UNVERIFIED",
        field: "ingredients",
        message: source.productType.trim()
          ? `商品類型 ${source.productType} 尚無可靠 PTD 證據可判定 ingredients 是否必填，請人工確認。`
          : "尚未取得可靠的商品類型／PTD 證據，無法判定 ingredients 是否必填，請人工確認。",
      });
    }
  }

  issues.push(...typoIssues(source.title, "title"));
  for (const bulletPoint of bulletPoints) {
    issues.push(...typoIssues(bulletPoint, "bulletPoints"));
  }
  issues.push(...typoIssues(source.ingredients, "ingredients"));

  return {
    sellerSku: source.sellerSku,
    asin: source.asin,
    productType: source.productType,
    title: source.title,
    bulletPoints,
    ingredients: source.ingredients,
    readStatus: "complete",
    readErrors,
    issues,
  };
}

export function auditListingContentRows(input: {
  marketplaceId: string;
  fetchedAt: string;
  rows: readonly ContentQualitySourceRow[];
}): ContentQualityAudit {
  const rows = input.rows.map(auditRow);
  const rowHas = (row: ContentQualityRow, kind: ContentQualityIssueKind) =>
    row.issues.some((issue) => issue.kind === kind);

  return {
    marketplaceId: input.marketplaceId,
    fetchedAt: input.fetchedAt,
    rows,
    readErrors: rows.flatMap((row) =>
      row.readErrors.map((error) => ({
        sellerSku: row.sellerSku,
        ...error,
      })),
    ),
    summary: {
      total: rows.length,
      completed: rows.filter((row) => row.readStatus === "complete").length,
      incomplete: rows.filter((row) => row.readStatus === "incomplete").length,
      withIssues: rows.filter((row) => row.issues.length > 0).length,
      suspectedTypos: rows.filter((row) => rowHas(row, "SUSPECTED_TYPO")).length,
      missingBullets: rows.filter((row) => rowHas(row, "MISSING_BULLETS")).length,
      missingIngredients: rows.filter((row) =>
        rowHas(row, "MISSING_INGREDIENTS"),
      ).length,
      ingredientsUnverified: rows.filter((row) =>
        rowHas(row, "INGREDIENTS_UNVERIFIED"),
      ).length,
    },
  };
}
