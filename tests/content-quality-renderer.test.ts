import { describe, expect, it } from "vitest";
import {
  contentHighlightSegments,
  locateInvisibleCharacters,
  summarizeContentAudit,
  type ContentAuditRow,
} from "../src/renderer/src/content-quality";
import {
  addPagesDictionarySpellingIssues,
  CONTENT_SPELLING_ALLOWLIST_COUNT,
  CONTENT_SPELLING_DICTIONARY_LANGUAGE,
  CONTENT_SPELLING_DICTIONARY_VERSION,
  sharedContentSpellingMatch,
} from "../src/renderer/src/content-spelling-rules";

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

const REQUESTED_APPROVED_TERMS = [
  "Inulin",
  "Pyridoxine",
  "artisanal",
  "Australian",
  "Superfood",
  "superfoods",
  "antioxidative",
  "Zealand",
  "Perilla",
  "Freschi",
  "Polyphosphate",
  "Choline",
  "Bitartrate",
  "Monopotassium",
  "Pyrophosphate",
  "Vietnam",
  "Croaker",
  "palatability",
  "Basa",
  "Pantothenate",
  "intolerances",
  "KCAL",
  "Taiwan",
  "taurine",
  "Flaxseed",
  "Botanicals",
  "Pawprint",
] as const;

function alternatingCase(value: string): string {
  return [...value]
    .map((character, index) =>
      index % 2 === 0
        ? character.toLocaleUpperCase("en-US")
        : character.toLocaleLowerCase("en-US"),
    )
    .join("");
}

describe("renderer content quality helpers", () => {
  it("uses one versioned general Pages dictionary on every platform", () => {
    expect(CONTENT_SPELLING_DICTIONARY_VERSION).toContain("dictionary-en@4.0.0");
    expect(CONTENT_SPELLING_DICTIONARY_LANGUAGE).toContain("en_US");
    expect(CONTENT_SPELLING_ALLOWLIST_COUNT).toBeGreaterThanOrEqual(46);
    const checked = addPagesDictionarySpellingIssues([{
      ...rows[0],
      title: "Trukey Tendons",
      bulletPoints: ["Naturall treats"],
      ingredients: "Cocount Glycerin",
      issues: [],
    }]);

    expect(checked[0].issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: "title",
        token: "Trukey",
        suggestion: "Turkey",
        source: "pages-dictionary",
      }),
      expect.objectContaining({
        field: "bulletPoints",
        token: "Naturall",
        suggestion: "Natural",
        source: "pages-dictionary",
      }),
      expect.objectContaining({
        field: "ingredients",
        token: "Cocount",
        suggestion: "Coconut",
        source: "pages-dictionary",
      }),
    ]));
  });

  it.each([
    ["Trukey", "turkey"],
    ["Protien", "protein"],
    ["Cocount", "coconut"],
    ["Artifical", "artificial"],
    ["Nutriton", "nutrition"],
    ["Resealabe", "resealable"],
    ["Naturall", "natural"],
    ["Ingrediants", "ingredients"],
    ["Mackeral", "mackerel"],
    ["recieve", "receive"],
    ["mistakke", "mistake"],
    ["Tukey", "turkey"],
  ])("classifies %s with the shared non-OS dictionary", (word, suggestion) => {
    expect(sharedContentSpellingMatch(word)).toEqual({
      suggestion,
      kind: "dictionary",
    });
  });

  it.each(["crunch", "turnkey", "resalable", "equality"])(
    "does not flag the valid English near-neighbor %s",
    (word) => {
      expect(sharedContentSpellingMatch(word)).toBeNull();
    },
  );

  it("always treats GooToE as an approved product term", () => {
    const brandedRows = [{
      ...rows[0],
      title: "GooToE dog treats",
      bulletPoints: ["GooToE training reward"],
    }];

    expect(addPagesDictionarySpellingIssues(brandedRows)[0].issues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ token: "GooToE" }),
      ]),
    );
  });

  it.each(REQUESTED_APPROVED_TERMS)(
    "keeps the requested approved term %s unchanged in mixed case",
    (approvedTerm) => {
      const mixedCase = alternatingCase(approvedTerm);
      const checked = addPagesDictionarySpellingIssues([{
        ...rows[0],
        title: mixedCase,
        bulletPoints: [],
        ingredients: "",
        issues: [],
      }]);

      expect(sharedContentSpellingMatch(approvedTerm.toLocaleLowerCase("en-US")))
        .toBeNull();
      expect(checked[0].title).toBe(mixedCase);
      expect(checked[0].issues).toEqual([]);
    },
  );

  it.each(["inulinn", "pyridoxinee", "artisanall", "xzealandx", "perillaa", "superfoodish"])(
    "does not let the approved term hide the different token %s",
    (word) => {
      expect(sharedContentSpellingMatch(word)).not.toBeNull();
    },
  );

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

    expect(addPagesDictionarySpellingIssues(approvedRows)[0].issues).toEqual([]);
  });

  it("keeps accepted catalog singular, plural and related variants out of typo results", () => {
    const accepted = [
      "snack", "snacks",
      "mineral", "minerals",
      "vitamin", "vitamins",
      "package", "packages",
      "customer", "customers",
      "protein", "proteins",
      "pretzel", "pretzels",
      "source", "sourced",
      "advertise", "advertised",
      "balance", "balanced",
      "indoor", "indoors",
      "medium", "mediums",
      "organic", "organics",
      "purr-fectly",
    ];
    const acceptedRows: ContentAuditRow[] = [{
      ...rows[0],
      title: accepted.join(" "),
      bulletPoints: [],
      ingredients: "",
      issues: [],
    }];

    expect(addPagesDictionarySpellingIssues(acceptedRows)[0].issues).toEqual([]);
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

  it("checks and highlights one misspelled part inside hyphenated catalog copy", () => {
    const original = "Trukey-Sourced treats";
    const checked = addPagesDictionarySpellingIssues([{
      ...rows[0],
      title: original,
      bulletPoints: [],
      ingredients: "",
      issues: [],
    }]);
    const titleIssues = checked[0].issues.filter((issue) => issue.field === "title");

    expect(titleIssues).toEqual([
      expect.objectContaining({ token: "Trukey", suggestion: "Turkey" }),
    ]);
    expect(
      contentHighlightSegments(original, titleIssues)
        .filter((segment) => segment.highlighted)
        .map((segment) => segment.text),
    ).toEqual(["Trukey"]);
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

  it("adds Pages dictionary suggestions without changing content", () => {
    const checked = addPagesDictionarySpellingIssues(rows);

    expect(checked[0].ingredients).toBe(rows[0].ingredients);
    expect(checked[0].issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "SUSPECTED_TYPO",
          field: "bulletPoints",
          token: "Naturall",
          suggestion: "Natural",
          source: "pages-dictionary",
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
    const checked = addPagesDictionarySpellingIssues(rows);

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

  it("still applies explicit rules after a very large clean listing", () => {
    const first: ContentAuditRow = {
      ...rows[0],
      title: "natural ".repeat(5_100),
      bulletPoints: [],
      ingredients: "",
      issues: [],
    };
    const later = {
      ...rows[0],
      title: "Trukey ".repeat(2_000),
      bulletPoints: ["Natural treats"],
      ingredients: "Turkey",
      issues: [],
    };
    const checked = addPagesDictionarySpellingIssues([first, later]);

    expect(checked[0].issues).toEqual([]);
    expect(checked[1].issues).toEqual([
      expect.objectContaining({ token: "Trukey", suggestion: "Turkey" }),
    ]);
  });

  it("does not apply spelling rules to incomplete rows", () => {
    const incomplete: ContentAuditRow = {
      ...rows[0],
      title: "Mistakke",
      readStatus: "incomplete",
      readErrors: [
        { code: "LISTING_QUERY_FAILED", message: "query failed" },
      ],
      issues: [],
    };

    expect(addPagesDictionarySpellingIssues([incomplete])[0].issues).toEqual([]);
  });
});
