import { describe, expect, it } from "vitest";
import {
  addLocalSpellcheckIssues,
  contentHighlightSegments,
  LOCAL_SPELLCHECK_WORD_LIMIT,
  locateInvisibleCharacters,
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

  it("keeps approved scientific, ingredient and brand terms out of typo results", () => {
    const approvedTerms = [
      "Decapterus",
      "Gluconate",
      "Niacinamide",
      "Reishi",
      "purr-fectly",
    ];
    const approvedRows = [{
      ...rows[0],
      title: approvedTerms.join(" "),
      bulletPoints: ["A purr-fectly balanced reward"],
      ingredients: "Zinc Gluconate, Niacinamide, Reishi",
      issues: [],
    }];

    expect(wordsForLocalSpellcheck(approvedRows)).not.toEqual(
      expect.arrayContaining(approvedTerms),
    );
    expect(
      addLocalSpellcheckIssues(
        approvedRows,
        approvedTerms.map((word) => ({ word, suggestions: ["different"] })),
      )[0].issues,
    ).toEqual([]);
  });

  it("locates U+200B with readable context and highlights it without changing content", () => {
    const original = "Natural & Gentle\u200b : clean nutrition";
    const invisibleRows: ContentAuditRow[] = [{
      ...rows[0],
      bulletPoints: [original],
      issues: [{
        kind: "SUSPECTED_TYPO",
        field: "bulletPoints",
        token: "U+200B",
        suggestion: "移除不可見字元",
        message: "發現不可見字元 U+200B。",
      }],
    }];

    expect(locateInvisibleCharacters(invisibleRows)).toEqual([
      expect.objectContaining({
        sellerSku: "AFA12AM",
        fieldLabel: "賣點 1",
        codePoint: "U+200B",
        name: "零寬空格",
        context: "Natural & Gentle⟦U+200B 零寬空格⟧ : clean nutrition",
        before: "Gentle",
        after: ":",
      }),
    ]);
    expect(contentHighlightSegments(original, invisibleRows[0].issues)).toEqual([
      { text: "Natural & Gentle", highlighted: false },
      { text: "⟦U+200B 零寬空格⟧", highlighted: true, token: "U+200B" },
      { text: " : clean nutrition", highlighted: false },
    ]);
    expect(invisibleRows[0].bulletPoints[0]).toBe(original);
  });

  it("marks typo tokens in the original copy without replacing them", () => {
    const original = "Naturall treats with Cocount Glycerin";
    const segments = contentHighlightSegments(original, [
      {
        kind: "SUSPECTED_TYPO",
        field: "bulletPoints",
        token: "Naturall",
        suggestion: "Natural",
        message: "疑似錯字",
      },
      {
        kind: "SUSPECTED_TYPO",
        field: "bulletPoints",
        token: "Cocount",
        suggestion: "Coconut",
        message: "疑似錯字",
      },
    ]);

    expect(segments.filter((segment) => segment.highlighted).map((segment) => segment.text))
      .toEqual(["Naturall", "Cocount"]);
    expect(segments.map((segment) => segment.text).join("")).toBe(original);
  });

  it("only highlights complete typo-token boundaries", () => {
    const original = "Naturall treats can be naturally tasty";
    const segments = contentHighlightSegments(original, [
      {
        kind: "SUSPECTED_TYPO",
        field: "bulletPoints",
        token: "Naturall",
        suggestion: "Natural",
        message: "疑似錯字",
      },
    ]);

    expect(
      segments.filter((segment) => segment.highlighted).map((segment) => segment.text),
    ).toEqual(["Naturall"]);
    expect(segments.map((segment) => segment.text).join("")).toBe(original);
    expect(
      segments.some(
        (segment) => segment.highlighted && segment.text === "naturall",
      ),
    ).toBe(false);
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
