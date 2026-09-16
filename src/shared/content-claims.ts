const SINGLE_INGREDIENT_CLAIM =
  /\bsingle(?:[\s\u00a0\p{Pd}_]+)ingredients?\b/giu;
const TENDON_CLAIM = /\btendons?\b/giu;
const HYPOALLERGENIC_CLAIM =
  /\bhypo(?:[\s\u00a0\p{Pd}_]*)allergenic\b/giu;
const TENDON_INGREDIENT = /\btendons?\b/iu;
const CHICKEN_INGREDIENT = /\bchicken\b/iu;
const GRAIN_FREE_CLAIM = /\bgrain[\s\u00a0\p{Pd}_]*free\b/giu;
// Explicit cereal names only; legumes and unspecified starch do not prove grain.
const GRAIN_TERM = String.raw`\b(?:wheat|rice|corn|maize|cornmeal|cornstarch|barley|oats?|oatmeal|rye|millet|sorghum|triticale|bulgur|teff)\b`;
const GRAIN_INGREDIENT = new RegExp(GRAIN_TERM, "giu");
const GRAIN_FREE_INGREDIENT_LIST = new RegExp(
  `${GRAIN_TERM}(?:[\\s,/&]+(?:(?:and|or)\\s+)?${GRAIN_TERM})*[\\s\\p{Pd}_]+free\\b`,
  "giu",
);

function grainIngredientTokens(ingredients: string): string[] {
  // A negated or possible-content clause is not positive ingredient evidence.
  // Keep commas within its scope, so "no wheat, corn or rice" stays excluded.
  const positiveEvidence = ingredients.normalize("NFKC")
    .replace(/\b(?:no|not|without|free\s+(?:from|of)|may\s+contain)\b[^.;\n\r\u0085\u2028\u2029]*/giu, " ")
    .replace(GRAIN_FREE_INGREDIENT_LIST, " ");
  return uniqueMatches(positiveEvidence, GRAIN_INGREDIENT);
}

function grainFreeClaimTokens(value: string): string[] {
  const positiveClaims = value.replace(
    /\b(?:not|never|without)\s+(?:(?:a|an)\s+)?grain[\s\u00a0\p{Pd}_]*free\b/giu,
    " ",
  );
  return uniqueMatches(positiveClaims, GRAIN_FREE_CLAIM);
}

export function singleIngredientClaimTokens(value: string): string[] {
  return [...value.matchAll(SINGLE_INGREDIENT_CLAIM)].map((match) => match[0]);
}

function normalizedIngredientEvidence(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function normalizedClaimToken(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\s\u00a0\p{Pd}_]+/gu, "-")
    .toLocaleLowerCase("en-US")
    .replace(/ingredients$/u, "ingredient");
}

function uniqueMatches(value: string, pattern: RegExp): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const match of value.matchAll(pattern)) {
    const token = match[0];
    const normalized = normalizedClaimToken(token);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    tokens.push(token);
  }
  return tokens;
}

export function provenIngredientItems(value: string): string[] {
  const items: string[] = [];
  let current = "";
  let depth = 0;
  for (const character of value) {
    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      current += character;
      continue;
    }
    if (character === ")" || character === "]" || character === "}") {
      depth = Math.max(0, depth - 1);
      current += character;
      continue;
    }
    if (
      depth === 0 &&
      (
        character === "," ||
        character === ";" ||
        character === "\n" ||
        character === "\r" ||
        character === "\u0085" ||
        character === "\u2028" ||
        character === "\u2029"
      )
    ) {
      const item = current.trim();
      if (item) items.push(item);
      current = "";
      continue;
    }
    current += character;
  }
  const finalItem = current.trim();
  if (finalItem) items.push(finalItem);
  const distinct = new Map<string, string>();
  for (const item of items) {
    const normalized = item
      .normalize("NFKC")
      .replace(/\s+/gu, " ")
      .trim()
      .replace(/[.!?。！？]+$/gu, "")
      .trim()
      .toLocaleLowerCase("en-US");
    if (!normalized) continue;
    if (!distinct.has(normalized)) distinct.set(normalized, item);
  }
  return distinct.size >= 2 ? [...distinct.values()] : [];
}

export type ContentClaimFinding = {
  field: "title" | "itemHighlight" | "bulletPoints";
  bulletIndex?: number;
  token: string;
  message: string;
};

export type SingleIngredientClaimFinding = ContentClaimFinding;

export function contentClaimTokens(
  value: string,
  ingredients: string,
): string[] {
  const evidence = normalizedIngredientEvidence(ingredients);
  if (!evidence) return [];
  const tokens: string[] = [];
  if (provenIngredientItems(ingredients).length >= 2) {
    tokens.push(...uniqueMatches(value, SINGLE_INGREDIENT_CLAIM));
  }
  if (!TENDON_INGREDIENT.test(evidence)) {
    tokens.push(...uniqueMatches(value, TENDON_CLAIM));
  }
  if (CHICKEN_INGREDIENT.test(evidence)) {
    tokens.push(...uniqueMatches(value, HYPOALLERGENIC_CLAIM));
  }
  if (grainIngredientTokens(ingredients).length > 0) {
    tokens.push(...grainFreeClaimTokens(value));
  }
  return tokens;
}

export function contentClaimFindings(input: {
  title: string;
  itemHighlight: string;
  bulletPoints: readonly string[];
  ingredients: string;
}): ContentClaimFinding[] {
  const evidence = normalizedIngredientEvidence(input.ingredients);
  if (!evidence) return [];
  const ingredientItems = provenIngredientItems(input.ingredients);
  const ingredientsContainTendon = TENDON_INGREDIENT.test(evidence);
  const ingredientsContainChicken = CHICKEN_INGREDIENT.test(evidence);
  const grainIngredients = grainIngredientTokens(input.ingredients);

  const findings: ContentClaimFinding[] = [];
  const add = (
    value: string,
    field: ContentClaimFinding["field"],
    bulletIndex?: number,
  ) => {
    const fieldName = field === "title"
      ? "產品名稱"
      : field === "itemHighlight"
        ? "產品亮點"
        : `產品要點 ${(bulletIndex ?? 0) + 1}`;
    if (ingredientItems.length >= 2) {
      for (const token of uniqueMatches(value, SINGLE_INGREDIENT_CLAIM)) {
        findings.push({
          field,
          bulletIndex,
          token,
          message:
            `${fieldName}宣稱「${token}」，但 Amazon ingredients 明確列出 ${ingredientItems.length} 項（${ingredientItems.join("、")}）；請核對並修正文案或成分資料。`,
        });
      }
    }
    if (!ingredientsContainTendon) {
      for (const token of uniqueMatches(value, TENDON_CLAIM)) {
        findings.push({
          field,
          bulletIndex,
          token,
          message:
            `${fieldName}提到「${token}」，但 Amazon ingredients 未列出 Tendon／Tendons；請核對並修正文案或成分資料。`,
        });
      }
    }
    if (ingredientsContainChicken) {
      for (const token of uniqueMatches(value, HYPOALLERGENIC_CLAIM)) {
        findings.push({
          field,
          bulletIndex,
          token,
          message:
            `${fieldName}宣稱「${token}」，但 Amazon ingredients 明確含 Chicken（常見過敏原）；請核對並修正文案或成分資料。`,
        });
      }
    }
    if (grainIngredients.length > 0) {
      for (const token of grainFreeClaimTokens(value)) {
        findings.push({
          field,
          bulletIndex,
          token,
          message:
            `${fieldName}宣稱「${token}」，但 Amazon ingredients 明確列有穀物或穀物來源成分（${grainIngredients.join("、")}）；請核對並修正文案或成分資料。`,
        });
      }
    }
  };

  add(input.title, "title");
  add(input.itemHighlight, "itemHighlight");
  input.bulletPoints.forEach((bulletPoint, bulletIndex) =>
    add(bulletPoint, "bulletPoints", bulletIndex));
  return findings;
}

export const singleIngredientClaimFindings = contentClaimFindings;
