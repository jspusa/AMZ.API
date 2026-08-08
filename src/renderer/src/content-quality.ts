import type { SpellcheckWordResult } from "../../shared/contracts";

export type ContentAuditIssueKind =
  | "MISSING_BULLETS"
  | "MISSING_INGREDIENTS"
  | "INGREDIENTS_UNVERIFIED"
  | "SUSPECTED_TYPO";

export type ContentAuditField = "title" | "bulletPoints" | "ingredients";

export type ContentAuditIssue = {
  kind: ContentAuditIssueKind;
  field: ContentAuditField;
  message: string;
  token?: string;
  suggestion?: string;
  source?: "amazon-content" | "mac-spellcheck";
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
  bulletPoints: string[];
  ingredients: string;
  readStatus: "complete" | "incomplete";
  readErrors: ContentAuditReadError[];
  issues: ContentAuditIssue[];
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
};

export type ContentAuditSnapshot = {
  marketplaceId: string;
  fetchedAt: string;
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

export const LOCAL_SPELLCHECK_WORD_LIMIT = 5_000;

const LOCAL_SPELLCHECK_ALLOWLIST = new Set([
  "afreschi",
  "asin",
  "fba",
  "fnsku",
  "sku",
  "amazon",
  "dog",
  "dogs",
  "rawhide",
  "resealable",
  "hypoallergenic",
  "glycerin",
  "glucosamine",
  "chondroitin",
  "gootoe",
  "decapterus",
  "gluconate",
  "niacinamide",
  "reishi",
  "purr-fectly",
]);

const INVISIBLE_CHARACTER = /[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/gu;

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

function candidateWords(value: string): string[] {
  return value.match(/[A-Za-z][A-Za-z'\u2019-]{2,}/g) ?? [];
}

function shouldCheckWord(word: string): boolean {
  const normalized = word.toLocaleLowerCase("en-US");
  if (normalized.length < 4 || LOCAL_SPELLCHECK_ALLOWLIST.has(normalized)) return false;
  if (word === word.toUpperCase()) return false;
  if (/[A-Z]/.test(word.slice(1))) return false;
  return true;
}

export function wordsForLocalSpellcheck(rows: readonly ContentAuditRow[]): string[] {
  const unique = new Map<string, string>();
  rowLoop:
  for (const row of rows) {
    if (row.readStatus !== "complete") continue;
    const values = [row.title, ...row.bulletPoints, row.ingredients];
    for (const value of values) {
      for (const word of candidateWords(value)) {
        if (!shouldCheckWord(word)) continue;
        const key = word.toLocaleLowerCase("en-US");
        if (!unique.has(key)) {
          unique.set(key, word);
          if (unique.size === LOCAL_SPELLCHECK_WORD_LIMIT) break rowLoop;
        }
      }
    }
  }
  return [...unique.values()];
}

function issueFieldLabel(field: ContentAuditField): string {
  if (field === "title") return "標題";
  if (field === "ingredients") return "成分";
  return "五大賣點";
}

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
      const wordCharacter = /[A-Za-z'\u2019-]/u;
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

export function addLocalSpellcheckIssues(
  rows: readonly ContentAuditRow[],
  misspellings: readonly SpellcheckWordResult[],
): ContentAuditRow[] {
  const byWord = new Map(
    misspellings.map((result) => [result.word.toLocaleLowerCase("en-US"), result]),
  );
  if (!byWord.size) return rows.map((row) => ({ ...row, issues: [...row.issues] }));

  return rows.map((row) => {
    if (row.readStatus !== "complete") {
      return { ...row, readErrors: [...row.readErrors], issues: [] };
    }
    const issues = [...row.issues];
    let localIssueCount = 0;
    const sources: Array<[ContentAuditField, string]> = [
      ["title", row.title],
      ["bulletPoints", row.bulletPoints.join("\n")],
      ["ingredients", row.ingredients],
    ];
    for (const [field, value] of sources) {
      if (localIssueCount >= 12) break;
      const seen = new Set<string>();
      let fieldIssueCount = 0;
      for (const token of candidateWords(value)) {
        if (localIssueCount >= 12 || fieldIssueCount >= 6) break;
        const key = token.toLocaleLowerCase("en-US");
        if (LOCAL_SPELLCHECK_ALLOWLIST.has(key)) continue;
        const result = byWord.get(key);
        if (!result || seen.has(key)) continue;
        seen.add(key);
        if (
          issues.some(
            (issue) =>
              issue.kind === "SUSPECTED_TYPO" &&
              issue.field === field &&
              issue.token?.toLocaleLowerCase("en-US") === key,
          )
        ) {
          continue;
        }
        const suggestion = result.suggestions[0];
        issues.push({
          kind: "SUSPECTED_TYPO",
          field,
          token,
          suggestion,
          source: "mac-spellcheck",
          message: `${issueFieldLabel(field)}疑似有錯字「${token}」${
            suggestion ? `，可檢查是否為「${suggestion}」` : ""
          }。`,
        });
        localIssueCount += 1;
        fieldIssueCount += 1;
      }
    }
    return { ...row, issues };
  });
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
  };
}
