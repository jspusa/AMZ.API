import createNSpell from "./vendor/spellcheck/nspell-2.1.5.js";
import englishAffix from "./vendor/spellcheck/en_US.aff?raw";
import englishDictionary from "./vendor/spellcheck/en_US.dic?raw";
import {
  CONTENT_SPELLING_ALLOWLIST_COUNT,
  CONTENT_SPELLING_DICTIONARY_LANGUAGE,
  CONTENT_SPELLING_DICTIONARY_VERSION,
} from "./content-spelling-metadata";
export {
  CONTENT_SPELLING_ALLOWLIST_COUNT,
  CONTENT_SPELLING_DICTIONARY_LANGUAGE,
  CONTENT_SPELLING_DICTIONARY_VERSION,
};

type ContentSpellingField =
  | "title"
  | "itemHighlight"
  | "bulletPoints"
  | "productDescription"
  | "ingredients";

type ContentSpellingIssue = Readonly<{
  kind:
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
  field: ContentSpellingField;
  message: string;
  token?: string;
  suggestion?: string;
  source?: "amazon-content" | "pages-dictionary";
  bulletIndex?: number;
  actualLength?: number;
  minLength?: number;
  maxLength?: number;
}>;

type ContentSpellingRow = Readonly<{
  title: string;
  itemHighlight?: string;
  bulletPoints: string[];
  productDescription?: string;
  ingredients: string;
  readStatus: "complete" | "incomplete";
  readErrors: readonly unknown[];
  issues: ContentSpellingIssue[];
}>;

type ContentSpellingResult<Row extends ContentSpellingRow> =
  Omit<Row, "issues"> & { issues: ContentSpellingIssue[] };

export type ContentSpellingMatch = Readonly<{
  suggestion?: string;
  kind: "dictionary";
}>;

// Product brands, scientific names, Amazon identifiers, and intentional copy
// that are absent from the general US dictionary.  Keep this list narrow:
// every entry suppresses a warning on both Mac and Windows.
const APPROVED_EXACT_TERMS = new Set([
  "afreschi",
  "antioxidative",
  "artisanal",
  "artificials",
  "asin",
  "australian",
  "basa",
  "bitartrate",
  "botanicals",
  "choline",
  "chondroitin",
  "croaker",
  "decapterus",
  "differentiator",
  "fba",
  "flaxseed",
  "fnsku",
  "freschi",
  "gluconate",
  "glucosamine",
  "gootoe",
  "glycerin",
  "ganoderma",
  "herz",
  "hypoallergenic",
  "inulin",
  "intolerances",
  "kcal",
  "monopotassium",
  "niacinamide",
  "palatability",
  "pantothenate",
  "pawprint",
  "perilla",
  "polyphosphate",
  "purr-fectly",
  "pyridoxine",
  "pyrophosphate",
  "rawhide",
  "reishi",
  "resealable",
  "sku",
  "superfood",
  "superfoods",
  "staffordshire",
  "american",
  "siberian",
  "taiwan",
  "taurine",
  "vietnam",
  "vitaday",
  "zealand",
  "cornucopiae",
]);

// Jasper intentionally places these concatenated shopper-search forms only in
// the backend product description. They remain spelling findings everywhere
// customers can see them: title, highlight, bullets, and ingredients.
const PRODUCT_DESCRIPTION_SEARCH_TERMS = new Set([
  "airdried",
  "grainfree",
  "dogfood",
  "airdry",
]);

if (APPROVED_EXACT_TERMS.size !== CONTENT_SPELLING_ALLOWLIST_COUNT) {
  throw new Error("Content spelling allowlist metadata is out of sync.");
}

const checker = createNSpell(englishAffix, englishDictionary);
const WORD_CANDIDATE = /[A-Za-z][A-Za-z'\u2019-]{2,}/gu;

function normalizedWord(value: string): string {
  return value.toLocaleLowerCase("en-US").replaceAll("\u2019", "'");
}

function shouldCheckWord(value: string): boolean {
  const normalized = normalizedWord(value);
  if (
    normalized.length < 4 ||
    APPROVED_EXACT_TERMS.has(normalized) ||
    !/^[a-z]+(?:'[a-z]+)?$/u.test(normalized)
  ) {
    return false;
  }
  if (value === value.toUpperCase()) return false;
  if (/[A-Z]/u.test(value.slice(1))) return false;
  return true;
}

function candidateWords(value: string): string[] {
  const result: string[] = [];
  const approvedContextStarts = new Set<number>();
  for (const match of value.matchAll(/\bcocker(?=\s+spaniel\b)/giu)) {
    if (match.index !== undefined) approvedContextStarts.add(match.index);
  }
  for (const match of value.matchAll(WORD_CANDIDATE)) {
    const token = match[0];
    if (
      match.index !== undefined &&
      approvedContextStarts.has(match.index) &&
      normalizedWord(token) === "cocker"
    ) {
      continue;
    }
    if (APPROVED_EXACT_TERMS.has(normalizedWord(token))) continue;
    for (const part of token.split("-")) {
      if (shouldCheckWord(part)) result.push(part);
    }
  }
  return result;
}

export function sharedContentSpellingMatch(word: string): ContentSpellingMatch | null {
  if (!shouldCheckWord(word)) return null;
  const normalized = normalizedWord(word);
  if (checker.correct(normalized)) return null;
  const suggestion = checker.suggest(normalized)[0];
  return suggestion
    ? { suggestion, kind: "dictionary" }
    : { kind: "dictionary" };
}

function issueFieldLabel(field: ContentSpellingField): string {
  if (field === "title") return "標題";
  if (field === "itemHighlight") return "產品亮點";
  if (field === "productDescription") return "產品敘述";
  if (field === "ingredients") return "成分";
  return "五大賣點";
}

function suggestionWithCase(token: string, suggestion: string): string {
  if (token === token.toUpperCase()) return suggestion.toUpperCase();
  if (token[0] === token[0]?.toUpperCase()) {
    return `${suggestion[0]?.toUpperCase() ?? ""}${suggestion.slice(1)}`;
  }
  return suggestion;
}

export function addPagesDictionarySpellingIssues<Row extends ContentSpellingRow>(
  rows: readonly Row[],
): Array<ContentSpellingResult<Row>> {
  const matchCache = new Map<string, ContentSpellingMatch | null>();
  return rows.map((row) => {
    if (row.readStatus !== "complete") {
      return { ...row, readErrors: [...row.readErrors], issues: [] };
    }
    const issues = [...row.issues];
    let rowIssueCount = 0;
    const sources: Array<[ContentSpellingField, string]> = [
      ["title", row.title],
      ["itemHighlight", row.itemHighlight ?? ""],
      ["bulletPoints", row.bulletPoints.join("\n")],
      ["productDescription", row.productDescription ?? ""],
      ["ingredients", row.ingredients],
    ];
    for (const [field, value] of sources) {
      if (rowIssueCount >= 12) break;
      const seen = new Set<string>();
      let fieldIssueCount = 0;
      for (const token of candidateWords(value)) {
        if (rowIssueCount >= 12 || fieldIssueCount >= 6) break;
        const key = normalizedWord(token);
        if (
          field === "productDescription" &&
          PRODUCT_DESCRIPTION_SEARCH_TERMS.has(key)
        ) {
          continue;
        }
        let spellingMatch = matchCache.get(key);
        if (!matchCache.has(key)) {
          spellingMatch = sharedContentSpellingMatch(token);
          matchCache.set(key, spellingMatch);
        }
        if (!spellingMatch || seen.has(key)) continue;
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
        const suggestion = spellingMatch.suggestion
          ? suggestionWithCase(token, spellingMatch.suggestion)
          : undefined;
        issues.push({
          kind: "SUSPECTED_TYPO",
          field,
          token,
          suggestion,
          source: "pages-dictionary",
          message: `${issueFieldLabel(field)}疑似有錯字「${token}」${
            suggestion ? `，可檢查是否為「${suggestion}」` : ""
          }。`,
        });
        rowIssueCount += 1;
        fieldIssueCount += 1;
      }
    }
    return { ...row, issues };
  });
}
