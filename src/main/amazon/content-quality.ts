import {
  contentClaimFindings,
} from "../../shared/content-claims";

export type ContentQualityIssueKind =
  | "MISSING_BULLETS"
  | "MISSING_INGREDIENTS"
  | "INGREDIENTS_UNVERIFIED"
  | "TITLE_BELOW_TARGET"
  | "HIGHLIGHT_BELOW_TARGET"
  | "BULLET_BELOW_TARGET"
  | "BULLET_ABOVE_TARGET"
  | "DESCRIPTION_BELOW_TARGET"
  | "SINGLE_INGREDIENT_MISMATCH"
  | "SUSPECTED_TYPO";

export type ContentQualityField =
  | "title"
  | "itemHighlight"
  | "bulletPoints"
  | "productDescription"
  | "ingredients";

export type ContentQualityIssue = {
  kind: ContentQualityIssueKind;
  field: ContentQualityField;
  message: string;
  token?: string;
  suggestion?: string;
  source?: "amazon-content" | "pages-dictionary";
  bulletIndex?: number;
  actualLength?: number;
  minLength?: number;
  maxLength?: number;
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
  itemHighlight?: string;
  bulletPoints: string[];
  productDescription?: string;
  ingredients: string;
  readStatus: "complete" | "incomplete";
  readErrors: ContentQualityReadError[];
};

export type ContentQualityRow = Omit<
  ContentQualitySourceRow,
  "itemHighlight" | "productDescription"
> & {
  itemHighlight: string;
  productDescription: string;
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
  titleBelowTarget: number;
  highlightBelowTarget: number;
  bulletBelowTarget: number;
  bulletAboveTarget: number;
  descriptionBelowTarget: number;
  singleIngredientMismatch: number;
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

export const CONTENT_QUALITY_LENGTH_TARGETS = Object.freeze({
  titleMinimum: 60,
  itemHighlightMinimum: 110,
  bulletMinimum: 150,
  bulletMaximum: 200,
  productDescriptionMinimum: 1_800,
});

export function trimmedUnicodeLength(value: string): number {
  return Array.from(value.trim()).length;
}

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
  const itemHighlight = source.itemHighlight ?? "";
  const bulletPoints = [...source.bulletPoints];
  const productDescription = source.productDescription ?? "";
  const readErrors = source.readErrors.map((error) => ({ ...error }));
  if (source.readStatus !== "complete") {
    return {
      ...source,
      itemHighlight,
      bulletPoints,
      productDescription,
      readStatus: "incomplete",
      readErrors,
      issues: [],
    };
  }
  const nonEmptyBulletCount = bulletPoints.filter((value) => value.trim()).length;
  const issues: ContentQualityIssue[] = [];

  const titleLength = trimmedUnicodeLength(source.title);
  if (titleLength < CONTENT_QUALITY_LENGTH_TARGETS.titleMinimum) {
    issues.push({
      kind: "TITLE_BELOW_TARGET",
      field: "title",
      message: `產品名稱目前 ${titleLength} 個字元，低於 ${CONTENT_QUALITY_LENGTH_TARGETS.titleMinimum} 個字元。`,
      actualLength: titleLength,
      minLength: CONTENT_QUALITY_LENGTH_TARGETS.titleMinimum,
    });
  }

  const highlightLength = trimmedUnicodeLength(itemHighlight);
  if (highlightLength < CONTENT_QUALITY_LENGTH_TARGETS.itemHighlightMinimum) {
    issues.push({
      kind: "HIGHLIGHT_BELOW_TARGET",
      field: "itemHighlight",
      message: `產品亮點目前 ${highlightLength} 個字元，低於 ${CONTENT_QUALITY_LENGTH_TARGETS.itemHighlightMinimum} 個字元。`,
      actualLength: highlightLength,
      minLength: CONTENT_QUALITY_LENGTH_TARGETS.itemHighlightMinimum,
    });
  }

  bulletPoints.forEach((bulletPoint, bulletIndex) => {
    const actualLength = trimmedUnicodeLength(bulletPoint);
    const lengthEvidence = {
      bulletIndex,
      actualLength,
      minLength: CONTENT_QUALITY_LENGTH_TARGETS.bulletMinimum,
      maxLength: CONTENT_QUALITY_LENGTH_TARGETS.bulletMaximum,
    };
    if (actualLength < CONTENT_QUALITY_LENGTH_TARGETS.bulletMinimum) {
      issues.push({
        kind: "BULLET_BELOW_TARGET",
        field: "bulletPoints",
        message: `產品要點 ${bulletIndex + 1} 目前 ${actualLength} 個字元，低於 ${CONTENT_QUALITY_LENGTH_TARGETS.bulletMinimum} 個字元。`,
        ...lengthEvidence,
      });
    } else if (actualLength > CONTENT_QUALITY_LENGTH_TARGETS.bulletMaximum) {
      issues.push({
        kind: "BULLET_ABOVE_TARGET",
        field: "bulletPoints",
        message: `產品要點 ${bulletIndex + 1} 目前 ${actualLength} 個字元，超過 ${CONTENT_QUALITY_LENGTH_TARGETS.bulletMaximum} 個字元。`,
        ...lengthEvidence,
      });
    }
  });

  const descriptionLength = trimmedUnicodeLength(productDescription);
  if (
    descriptionLength <
    CONTENT_QUALITY_LENGTH_TARGETS.productDescriptionMinimum
  ) {
    issues.push({
      kind: "DESCRIPTION_BELOW_TARGET",
      field: "productDescription",
      message: `產品敘述目前 ${descriptionLength} 個字元，低於 ${CONTENT_QUALITY_LENGTH_TARGETS.productDescriptionMinimum} 個字元。`,
      actualLength: descriptionLength,
      minLength: CONTENT_QUALITY_LENGTH_TARGETS.productDescriptionMinimum,
    });
  }

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

  issues.push(...contentClaimFindings({
    title: source.title,
    itemHighlight,
    bulletPoints,
    ingredients: source.ingredients,
  }).map((finding) => ({
    kind: "SINGLE_INGREDIENT_MISMATCH" as const,
    ...finding,
  })));

  issues.push(...typoIssues(source.title, "title"));
  issues.push(...typoIssues(itemHighlight, "itemHighlight"));
  for (const bulletPoint of bulletPoints) {
    issues.push(...typoIssues(bulletPoint, "bulletPoints"));
  }
  issues.push(...typoIssues(productDescription, "productDescription"));
  issues.push(...typoIssues(source.ingredients, "ingredients"));

  return {
    sellerSku: source.sellerSku,
    asin: source.asin,
    productType: source.productType,
    title: source.title,
    itemHighlight,
    bulletPoints,
    productDescription,
    ingredients: source.ingredients,
    readStatus: "complete",
    readErrors,
    issues,
  };
}

export function summarizeContentQualityRows(
  rows: readonly ContentQualityRow[],
): ContentQualitySummary {
  const rowHas = (row: ContentQualityRow, kind: ContentQualityIssueKind) =>
    row.issues.some((issue) => issue.kind === kind);
  return {
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
    titleBelowTarget: rows.filter((row) =>
      rowHas(row, "TITLE_BELOW_TARGET"),
    ).length,
    highlightBelowTarget: rows.filter((row) =>
      rowHas(row, "HIGHLIGHT_BELOW_TARGET"),
    ).length,
    bulletBelowTarget: rows.filter((row) =>
      rowHas(row, "BULLET_BELOW_TARGET"),
    ).length,
    bulletAboveTarget: rows.filter((row) =>
      rowHas(row, "BULLET_ABOVE_TARGET"),
    ).length,
    descriptionBelowTarget: rows.filter((row) =>
      rowHas(row, "DESCRIPTION_BELOW_TARGET"),
    ).length,
    singleIngredientMismatch: rows.filter((row) =>
      rowHas(row, "SINGLE_INGREDIENT_MISMATCH"),
    ).length,
  };
}

export function auditListingContentRows(input: {
  marketplaceId: string;
  fetchedAt: string;
  rows: readonly ContentQualitySourceRow[];
}): ContentQualityAudit {
  const rows = input.rows.map(auditRow);
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
    summary: summarizeContentQualityRows(rows),
  };
}
