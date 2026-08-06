import { describe, expect, it } from "vitest";
import {
  addLocalSpellcheckIssues,
  LOCAL_SPELLCHECK_WORD_LIMIT,
  summarizeContentAudit,
  wordsForLocalSpellcheck,
  type ContentAuditRow,
} from "../src/renderer/src/content-quality";

const rows: ContentAuditRow[] = [
  {
    sellerSku: "AFA12AM",
    asin: "B09S5VY2JS",
    productType: "PET_FOOD",
    title: "AFreschi Turkey Tendons",
    bulletPoints: ["Naturall treats for dogs", "FBA READY"],
    ingredients: "Turkey Tendon, Cocount Glycerin",
    readStatus: "complete",
    readErrors: [],
    issues: [
      {
        kind: "MISSING_BULLETS",
        field: "bulletPoints",
        message: "目前只有 2 個賣點。",
      },
    ],
  },
];

describe("renderer content quality helpers", () => {
  it("collects bounded English words while excluding brands and acronyms", () => {
    const words = wordsForLocalSpellcheck(rows);

    expect(words).toContain("Naturall");
    expect(words).toContain("Cocount");
    expect(words).not.toContain("AFreschi");
    expect(words).not.toContain("FBA");
  });

  it("always treats GooToE as an approved product term", () => {
    const brandedRows = [{
      ...rows[0],
      title: "GooToE dog treats",
      bulletPoints: ["GooToE training reward"],
    }];

    expect(wordsForLocalSpellcheck(brandedRows)).not.toContain("GooToE");
    expect(
      addLocalSpellcheckIssues(brandedRows, [
        { word: "GooToE", suggestions: ["Goatee"] },
      ])[0].issues,
    ).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ token: "GooToE" }),
      ]),
    );
  });

  it("adds Mac-local spelling suggestions without changing content", () => {
    const checked = addLocalSpellcheckIssues(rows, [
      { word: "Naturall", suggestions: ["Natural"] },
      { word: "Cocount", suggestions: ["Coconut"] },
    ]);

    expect(checked[0].ingredients).toBe(rows[0].ingredients);
    expect(checked[0].issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "SUSPECTED_TYPO",
          field: "bulletPoints",
          token: "Naturall",
          suggestion: "Natural",
          source: "mac-spellcheck",
        }),
        expect.objectContaining({
          kind: "SUSPECTED_TYPO",
          field: "ingredients",
          token: "Cocount",
          suggestion: "Coconut",
        }),
      ]),
    );
  });

  it("counts affected SKUs once per issue category", () => {
    const checked = addLocalSpellcheckIssues(rows, [
      { word: "Naturall", suggestions: ["Natural"] },
      { word: "Cocount", suggestions: ["Coconut"] },
    ]);

    expect(summarizeContentAudit(checked, 12)).toEqual({
      total: 12,
      completed: 1,
      incomplete: 0,
      withIssues: 1,
      suspectedTypos: 1,
      missingBullets: 1,
      missingIngredients: 0,
      ingredientsUnverified: 0,
    });
  });

  it("stops collecting immediately at 5,000 unique words", () => {
    const suffix = (value: number): string => {
      let result = "";
      let current = value;
      do {
        result = String.fromCharCode(97 + (current % 26)) + result;
        current = Math.floor(current / 26);
      } while (current > 0);
      return result.padStart(4, "a");
    };
    const first: ContentAuditRow = {
      ...rows[0],
      title: Array.from(
        { length: LOCAL_SPELLCHECK_WORD_LIMIT },
        (_, index) => `catalogword${suffix(index)}`,
      ).join(" "),
      bulletPoints: [],
      ingredients: "",
    };
    const later = { ...rows[0] };
    Object.defineProperty(later, "title", {
      get: () => {
        throw new Error("collector scanned past its limit");
      },
    });

    const words = wordsForLocalSpellcheck([first, later]);

    expect(words).toHaveLength(LOCAL_SPELLCHECK_WORD_LIMIT);
  });

  it("does not spellcheck incomplete rows", () => {
    const incomplete: ContentAuditRow = {
      ...rows[0],
      title: "Mistakke",
      readStatus: "incomplete",
      readErrors: [
        { code: "LISTING_QUERY_FAILED", message: "query failed" },
      ],
      issues: [],
    };

    expect(wordsForLocalSpellcheck([incomplete])).toEqual([]);
    expect(
      addLocalSpellcheckIssues([incomplete], [
        { word: "Mistakke", suggestions: ["Mistake"] },
      ])[0].issues,
    ).toEqual([]);
  });
});
