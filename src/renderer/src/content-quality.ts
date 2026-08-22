export type ContentAuditIssueKind =
  | "MISSING_BULLETS"
  | "MISSING_INGREDIENTS"
  | "INGREDIENTS_UNVERIFIED"
  | "TITLE_BELOW_TARGET"
  | "HIGHLIGHT_BELOW_TARGET"
  | "BULLET_BELOW_TARGET"
  | "BULLET_ABOVE_TARGET"
  | "DESCRIPTION_BELOW_TARGET"
  | "SUSPECTED_TYPO";

export type ContentAuditField =
  | "title"
  | "itemHighlight"
  | "bulletPoints"
  | "productDescription"
  | "ingredients";

export type ContentAuditIssue = {
  kind: ContentAuditIssueKind;
  field: ContentAuditField;
  message: string;
  token?: string;
  suggestion?: string;
  source?: "amazon-content" | "pages-dictionary";
  bulletIndex?: number;
  actualLength?: number;
  minLength?: number;
  maxLength?: number;
};

export type ContentAuditReadError = {
  code: "LISTING_QUERY_FAILED" | "LISTING_CONTENT_NOT_RETURNED";
  message: string;
};

export type ContentAuditRow = {
  sellerSku: string;
  asin: string;
  productType: string;
  title: string;
  itemHighlight?: string;
  bulletPoints: string[];
  productDescription?: string;
  ingredients: string;
  readStatus: "complete" | "incomplete";
  readErrors: ContentAuditReadError[];
  issues: ContentAuditIssue[];
  variationRole?: "parent" | "child" | "standalone" | "unknown";
  variationParentSku?: string | null;
  variationFamilyKey?: string | null;
  variationTheme?: string | null;
  relationshipStatus?: "complete" | "incomplete";
  relationshipMessage?: string | null;
};

export type ContentAuditSummary = {
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
};

export type ContentAuditSnapshot = {
  marketplaceId: string;
  fetchedAt: string;
  exportId?: string;
  rows: ContentAuditRow[];
  readErrors: Array<ContentAuditReadError & { sellerSku: string }>;
  summary: ContentAuditSummary;
};

export type ContentHighlightSegment = {
  text: string;
  highlighted: boolean;
  token?: string;
};

export type InvisibleCharacterLocation = {
  sellerSku: string;
  field: ContentAuditField;
  fieldLabel: string;
  codePoint: string;
  name: string;
  context: string;
  before: string;
  after: string;
};

const INVISIBLE_CHARACTER = /[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/gu;

export const CONTENT_AUDIT_LENGTH_TARGETS = Object.freeze({
  titleMinimum: 60,
  itemHighlightMinimum: 110,
  bulletMinimum: 150,
  bulletMaximum: 200,
  productDescriptionMinimum: 1_800,
});

export function trimmedUnicodeLength(value: string): number {
  return Array.from(value.trim()).length;
}

const INVISIBLE_CHARACTER_NAMES: Readonly<Record<string, string>> = {
  "U+200B": "零寬空格",
  "U+200C": "零寬非連接符",
  "U+200D": "零寬連接符",
  "U+200E": "左至右標記",
  "U+200F": "右至左標記",
  "U+202A": "左至右嵌入",
  "U+202B": "右至左嵌入",
  "U+202C": "彈出方向格式",
  "U+202D": "左至右覆寫",
  "U+202E": "右至左覆寫",
  "U+2060": "單字連接符",
  "U+FEFF": "零寬不換行空格／BOM",
};

function codePointLabel(character: string): string {
  return `U+${(character.codePointAt(0) ?? 0)
    .toString(16)
    .toUpperCase()
    .padStart(4, "0")}`;
}

export function isInvisibleCharacterIssue(issue: ContentAuditIssue): boolean {
  return /^U\+[0-9A-F]{4,6}$/iu.test(issue.token ?? "");
}

function visibleInvisibleCharacters(value: string): string {
  return value.replace(INVISIBLE_CHARACTER, (character) => {
    const codePoint = codePointLabel(character);
    return `⟦${codePoint} ${INVISIBLE_CHARACTER_NAMES[codePoint] ?? "不可見字元"}⟧`;
  });
}

function adjacentToken(value: string, direction: "before" | "after"): string {
  if (direction === "before") {
    const match = value.trimEnd().match(/([\p{L}\p{N}’'\-]+|[^\s])$/u);
    return match?.[1] ?? "前方文字";
  }
  const match = value.trimStart().match(/^([\p{L}\p{N}’'\-]+|[^\s])/u);
  return match?.[1] ?? "後方文字";
}

function invisibleLocationsInValue(
  sellerSku: string,
  field: ContentAuditField,
  fieldLabel: string,
  value: string,
  expectedCodePoints: ReadonlySet<string>,
): InvisibleCharacterLocation[] {
  const locations: InvisibleCharacterLocation[] = [];
  for (const match of value.matchAll(INVISIBLE_CHARACTER)) {
    const character = match[0];
    const index = match.index;
    const codePoint = codePointLabel(character);
    if (!expectedCodePoints.has(codePoint)) continue;
    const start = Math.max(0, index - 36);
    const end = Math.min(value.length, index + character.length + 36);
    const leadingEllipsis = start > 0 ? "…" : "";
    const trailingEllipsis = end < value.length ? "…" : "";
    const context = `${leadingEllipsis}${visibleInvisibleCharacters(
      value.slice(start, end),
    ).replaceAll("\n", " ↵ ")}${trailingEllipsis}`;
    locations.push({
      sellerSku,
      field,
      fieldLabel,
      codePoint,
      name: INVISIBLE_CHARACTER_NAMES[codePoint] ?? "不可見字元",
      context,
      before: adjacentToken(value.slice(0, index), "before"),
      after: adjacentToken(value.slice(index + character.length), "after"),
    });
  }
  return locations;
}

export function locateInvisibleCharacters(
  rows: readonly ContentAuditRow[],
): InvisibleCharacterLocation[] {
  return rows.flatMap((row) => {
    if (row.readStatus !== "complete") return [];
    const expectedCodePoints = new Set(
      row.issues
        .filter(isInvisibleCharacterIssue)
        .map((issue) => issue.token?.toUpperCase())
        .filter((token): token is string => Boolean(token)),
    );
    if (!expectedCodePoints.size) return [];
    return [
      ...invisibleLocationsInValue(
        row.sellerSku,
        "title",
        "商品標題",
        row.title,
        expectedCodePoints,
      ),
      ...invisibleLocationsInValue(
        row.sellerSku,
        "itemHighlight",
        "產品亮點",
        row.itemHighlight ?? "",
        expectedCodePoints,
      ),
      ...row.bulletPoints.flatMap((bulletPoint, index) =>
        invisibleLocationsInValue(
          row.sellerSku,
          "bulletPoints",
          `賣點 ${index + 1}`,
          bulletPoint,
          expectedCodePoints,
        ),
      ),
      ...invisibleLocationsInValue(
        row.sellerSku,
        "productDescription",
        "產品敘述",
        row.productDescription ?? "",
        expectedCodePoints,
      ),
      ...invisibleLocationsInValue(
        row.sellerSku,
        "ingredients",
        "成分",
        row.ingredients,
        expectedCodePoints,
      ),
    ];
  });
}

type HighlightRange = {
  start: number;
  end: number;
  token: string;
  replacement?: string;
};

function issueHighlightRanges(
  value: string,
  issues: readonly ContentAuditIssue[],
): HighlightRange[] {
  const ranges: HighlightRange[] = [];
  const loweredValue = value.toLocaleLowerCase("en-US");

  for (const issue of issues) {
    if (issue.kind !== "SUSPECTED_TYPO" || !issue.token) continue;
    if (isInvisibleCharacterIssue(issue)) {
      const numeric = Number.parseInt(issue.token.slice(2), 16);
      if (!Number.isFinite(numeric) || numeric < 0 || numeric > 0x10ffff) continue;
      const character = String.fromCodePoint(numeric);
      let index = value.indexOf(character);
      while (index >= 0 && ranges.length < 60) {
        const codePoint = issue.token.toUpperCase();
        ranges.push({
          start: index,
          end: index + character.length,
          token: codePoint,
          replacement: `⟦${codePoint} ${INVISIBLE_CHARACTER_NAMES[codePoint] ?? "不可見字元"}⟧`,
        });
        index = value.indexOf(character, index + character.length);
      }
      continue;
    }

    const loweredToken = issue.token.toLocaleLowerCase("en-US");
    let index = loweredValue.indexOf(loweredToken);
    while (index >= 0 && ranges.length < 60) {
      const end = index + issue.token.length;
      const previous = index > 0 ? value[index - 1] : "";
      const next = end < value.length ? value[end] : "";
      const wordCharacter = /[A-Za-z'\u2019]/u;
      if (!wordCharacter.test(previous) && !wordCharacter.test(next)) {
        ranges.push({
          start: index,
          end,
          token: issue.token,
        });
      }
      index = loweredValue.indexOf(loweredToken, index + issue.token.length);
    }
  }

  const accepted: HighlightRange[] = [];
  for (const range of ranges.sort((left, right) =>
    left.start - right.start || right.end - left.end,
  )) {
    if (accepted.some((current) => range.start < current.end && range.end > current.start)) {
      continue;
    }
    accepted.push(range);
  }
  return accepted;
}

export function contentHighlightSegments(
  value: string,
  issues: readonly ContentAuditIssue[],
): ContentHighlightSegment[] {
  const ranges = issueHighlightRanges(value, issues);
  if (!ranges.length) return [{ text: value, highlighted: false }];

  const segments: ContentHighlightSegment[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) {
      segments.push({ text: value.slice(cursor, range.start), highlighted: false });
    }
    segments.push({
      text: range.replacement ?? value.slice(range.start, range.end),
      highlighted: true,
      token: range.token,
    });
    cursor = range.end;
  }
  if (cursor < value.length) {
    segments.push({ text: value.slice(cursor), highlighted: false });
  }
  return segments;
}

export function summarizeContentAudit(
  rows: readonly ContentAuditRow[],
  total = rows.length,
): ContentAuditSummary {
  const hasKind = (row: ContentAuditRow, kind: ContentAuditIssueKind) =>
    row.issues.some((issue) => issue.kind === kind);
  return {
    total,
    completed: rows.filter((row) => row.readStatus === "complete").length,
    incomplete: rows.filter((row) => row.readStatus === "incomplete").length,
    withIssues: rows.filter((row) => row.issues.length > 0).length,
    suspectedTypos: rows.filter((row) => hasKind(row, "SUSPECTED_TYPO")).length,
    missingBullets: rows.filter((row) => hasKind(row, "MISSING_BULLETS")).length,
    missingIngredients: rows.filter((row) =>
      hasKind(row, "MISSING_INGREDIENTS"),
    ).length,
    ingredientsUnverified: rows.filter((row) =>
      hasKind(row, "INGREDIENTS_UNVERIFIED"),
    ).length,
    titleBelowTarget: rows.filter((row) =>
      hasKind(row, "TITLE_BELOW_TARGET"),
    ).length,
    highlightBelowTarget: rows.filter((row) =>
      hasKind(row, "HIGHLIGHT_BELOW_TARGET"),
    ).length,
    bulletBelowTarget: rows.filter((row) =>
      hasKind(row, "BULLET_BELOW_TARGET"),
    ).length,
    bulletAboveTarget: rows.filter((row) =>
      hasKind(row, "BULLET_ABOVE_TARGET"),
    ).length,
    descriptionBelowTarget: rows.filter((row) =>
      hasKind(row, "DESCRIPTION_BELOW_TARGET"),
    ).length,
  };
}
