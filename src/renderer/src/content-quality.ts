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
]);

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
