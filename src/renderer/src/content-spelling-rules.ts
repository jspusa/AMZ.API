import createNSpell from "./vendor/spellcheck/nspell-2.1.5.js";
import englishAffix from "./vendor/spellcheck/en_US.aff?raw";
import englishDictionary from "./vendor/spellcheck/en_US.dic?raw";
import type {
  ContentAuditField,
  ContentAuditRow,
} from "./content-quality";

export const CONTENT_SPELLING_DICTIONARY_VERSION =
  "dictionary-en@4.0.0 / nspell@2.1.5";
export const CONTENT_SPELLING_DICTIONARY_LANGUAGE = "SCOWL en_US 2020.12.07";

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
  "fba",
  "flaxseed",
  "fnsku",
  "freschi",
  "gluconate",
  "glucosamine",
  "gootoe",
  "glycerin",
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
  "taiwan",
  "taurine",
  "vietnam",
  "vitaday",
  "zealand",
]);

export const CONTENT_SPELLING_ALLOWLIST_COUNT = APPROVED_EXACT_TERMS.size;

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
  for (const match of value.matchAll(WORD_CANDIDATE)) {
    const token = match[0];
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

function issueFieldLabel(field: ContentAuditField): string {
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

export function addPagesDictionarySpellingIssues(
  rows: readonly ContentAuditRow[],
): ContentAuditRow[] {
  const matchCache = new Map<string, ContentSpellingMatch | null>();
  return rows.map((row) => {
    if (row.readStatus !== "complete") {
      return { ...row, readErrors: [...row.readErrors], issues: [] };
    }
    const issues = [...row.issues];
    let rowIssueCount = 0;
    const sources: Array<[ContentAuditField, string]> = [
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
