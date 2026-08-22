const SINGLE_INGREDIENT_CLAIM =
  /\bsingle(?:[\s\u00a0\p{Pd}_]+)ingredients?\b/giu;

export function singleIngredientClaimTokens(value: string): string[] {
  return [...value.matchAll(SINGLE_INGREDIENT_CLAIM)].map((match) => match[0]);
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

export type SingleIngredientClaimFinding = {
  field: "title" | "itemHighlight" | "bulletPoints";
  bulletIndex?: number;
  token: string;
  message: string;
};

export function singleIngredientClaimFindings(input: {
  title: string;
  itemHighlight: string;
  bulletPoints: readonly string[];
  ingredients: string;
}): SingleIngredientClaimFinding[] {
  const ingredientItems = provenIngredientItems(input.ingredients);
  if (ingredientItems.length < 2) return [];

  const findings: SingleIngredientClaimFinding[] = [];
  const add = (
    value: string,
    field: SingleIngredientClaimFinding["field"],
    bulletIndex?: number,
  ) => {
    const fieldName = field === "title"
      ? "產品名稱"
      : field === "itemHighlight"
        ? "產品亮點"
        : `產品要點 ${(bulletIndex ?? 0) + 1}`;
    const seenTokens = new Set<string>();
    for (const token of singleIngredientClaimTokens(value)) {
      const normalizedToken = token
        .normalize("NFKC")
        .replace(/[\s\u00a0\p{Pd}_]+/gu, "-")
        .toLocaleLowerCase("en-US")
        .replace(/ingredients$/u, "ingredient");
      if (seenTokens.has(normalizedToken)) continue;
      seenTokens.add(normalizedToken);
      findings.push({
        field,
        bulletIndex,
        token,
        message:
          `${fieldName}宣稱「${token}」，但 Amazon ingredients 明確列出 ${ingredientItems.length} 項（${ingredientItems.join("、")}）；請核對並修正文案或成分資料。`,
      });
    }
  };

  add(input.title, "title");
  add(input.itemHighlight, "itemHighlight");
  input.bulletPoints.forEach((bulletPoint, bulletIndex) =>
    add(bulletPoint, "bulletPoints", bulletIndex));
  return findings;
}
