import type { MarketplaceId } from "../../shared/marketplaces";
import type {
  BusinessPricingCapability,
  BusinessQuantityDiscountLevel,
} from "./business-pricing-types";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonPointer(root: JsonRecord, ref: string): unknown {
  if (!ref.startsWith("#/")) return null;
  return ref
    .slice(2)
    .split("/")
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))
    .reduce<unknown>((current, part) =>
      isRecord(current) ? current[part] : undefined, root);
}

const BUSINESS_SCHEMA_MAX_VISITS = 4_096;
const BUSINESS_SCHEMA_MAX_DEPTH = 48;

type BusinessSchemaTraversal = {
  remaining: number;
  exhausted: boolean;
  safe: boolean;
};

type ExactStringEvaluation = {
  matches: boolean | null;
  constrained: boolean;
};

type BusinessOfferSelector = {
  audience: "B2B";
  marketplaceId: MarketplaceId;
  currencyCode: string;
};

type BusinessOfferPriceBranch = {
  offerPath: readonly unknown[];
  offerSchema: JsonRecord;
  price: unknown;
  quantityDiscountPlan: unknown;
  selectorProven: boolean;
};

const BUSINESS_PRICE_ONLY_OFFER_PROPERTIES = [
  "marketplace_id",
  "currency",
  "audience",
  "our_price",
] as const;

const BUSINESS_COMBINED_OFFER_PROPERTIES = [
  ...BUSINESS_PRICE_ONLY_OFFER_PROPERTIES,
  "quantity_discount_plan",
] as const;

function newBusinessSchemaTraversal(): BusinessSchemaTraversal {
  return {
    remaining: BUSINESS_SCHEMA_MAX_VISITS,
    exhausted: false,
    safe: true,
  };
}

function consumeBusinessSchemaNode(
  traversal: BusinessSchemaTraversal,
  depth: number,
): boolean {
  if (depth > BUSINESS_SCHEMA_MAX_DEPTH || traversal.remaining <= 0) {
    traversal.exhausted = true;
    traversal.safe = false;
    return false;
  }
  traversal.remaining -= 1;
  return true;
}

function reserveBusinessSchemaCollection(
  traversal: BusinessSchemaTraversal,
  length: number,
): boolean {
  if (
    !Number.isSafeInteger(length) || length < 0 ||
    length > traversal.remaining
  ) {
    traversal.exhausted = true;
    traversal.safe = false;
    return false;
  }
  return true;
}

function directEditableFlags(node: unknown): boolean[] {
  if (!isRecord(node)) return [];
  const flags: boolean[] = [];
  if ("editable" in node) {
    flags.push(typeof node.editable === "boolean" ? node.editable : false);
  }
  if ("readOnly" in node && node.readOnly !== false) flags.push(false);
  return flags;
}

function conjunctExactStringEvaluations(
  evaluations: readonly ExactStringEvaluation[],
): ExactStringEvaluation {
  if (evaluations.some((evaluation) => evaluation.matches === false)) {
    return { matches: false, constrained: true };
  }
  if (evaluations.some((evaluation) => evaluation.matches === null)) {
    return {
      matches: null,
      constrained: evaluations.some((evaluation) => evaluation.constrained),
    };
  }
  return {
    matches: true,
    constrained: evaluations.some((evaluation) => evaluation.constrained),
  };
}

const BUSINESS_SELECTOR_SCHEMA_KEYS = new Set([
  "$anchor",
  "$comment",
  "$defs",
  "$id",
  "$ref",
  "$schema",
  "$lifecycle",
  "allOf",
  "anyOf",
  "const",
  "contentEncoding",
  "contentMediaType",
  "contentSchema",
  "default",
  "deprecated",
  "description",
  "editable",
  "else",
  "enum",
  "enumDeprecated",
  "enumNames",
  "examples",
  "format",
  "hidden",
  "if",
  "maxLength",
  "maxUtf8ByteLength",
  "minLength",
  "minUtf8ByteLength",
  "not",
  "oneOf",
  "pattern",
  "readOnly",
  "replacedBy",
  "replaces",
  "selectors",
  "then",
  "title",
  "type",
  "writeOnly",
]);

const BUSINESS_REF_ANNOTATION_KEYS = new Set([
  "$anchor",
  "$comment",
  "$id",
  "$ref",
  "$schema",
  "$lifecycle",
  "default",
  "deprecated",
  "description",
  "editable",
  "enumDeprecated",
  "enumNames",
  "examples",
  "hidden",
  "readOnly",
  "replacedBy",
  "replaces",
  "selectors",
  "title",
  "writeOnly",
]);

const BUSINESS_OFFER_SCHEMA_KEYS = new Set([
  ...BUSINESS_REF_ANNOTATION_KEYS,
  "additionalProperties",
  "allOf",
  "anyOf",
  "editable",
  "hidden",
  "items",
  "maxItems",
  "maxUniqueItems",
  "minItems",
  "minUniqueItems",
  "oneOf",
  "properties",
  "required",
  "selectors",
  "type",
  "uniqueItems",
]);

const BUSINESS_PRICE_PATH_SCHEMA_KEYS = new Set([
  ...BUSINESS_REF_ANNOTATION_KEYS,
  "$defs",
  "additionalProperties",
  "const",
  "editable",
  "enum",
  "enumNames",
  "exclusiveMaximum",
  "exclusiveMinimum",
  "format",
  "hidden",
  "items",
  "maximum",
  "maxItems",
  "maxUniqueItems",
  "maxLength",
  "maxProperties",
  "minimum",
  "minItems",
  "minUniqueItems",
  "minLength",
  "minProperties",
  "multipleOf",
  "pattern",
  "properties",
  "required",
  "selectors",
  "type",
  "uniqueItems",
]);

// Attribute discovery is intentionally narrower than a general JSON Schema
// evaluator. Unknown assertions or applicators at the PTD root can change
// whether `purchasable_offer` is valid, so they make B2B writes read-only.
const BUSINESS_ATTRIBUTE_ROOT_SCHEMA_KEYS = new Set([
  ...BUSINESS_REF_ANNOTATION_KEYS,
  "$defs",
  "additionalProperties",
  "definitions",
  "editable",
  "hidden",
  "properties",
  "required",
  "selectors",
  "type",
]);

function hasBusinessRefSiblings(node: JsonRecord): boolean {
  return typeof node.$ref === "string" &&
    Object.keys(node).some((key) => !BUSINESS_REF_ANNOTATION_KEYS.has(key));
}

type BusinessStructuralType =
  | "array"
  | "object"
  | "number"
  | "integer"
  | "string";

function businessSchemaAllowsType(
  node: JsonRecord,
  expected: BusinessStructuralType,
): boolean {
  if (!("type" in node)) return true;
  const types = Array.isArray(node.type) ? node.type : [node.type];
  return types.length > 0 && types.every((type) => typeof type === "string") &&
    types.includes(expected);
}

function businessSchemaAllowsArrayLengthRange(
  node: JsonRecord,
  minimumRequested: number,
  maximumRequested: number,
): boolean {
  if (
    !Number.isSafeInteger(minimumRequested) || minimumRequested < 0 ||
    !Number.isSafeInteger(maximumRequested) ||
    maximumRequested < minimumRequested
  ) return false;
  const minItems = "minItems" in node ? node.minItems : 0;
  const maxItems = "maxItems" in node ? node.maxItems : Number.POSITIVE_INFINITY;
  const minUniqueItems = "minUniqueItems" in node ? node.minUniqueItems : 0;
  const maxUniqueItems = "maxUniqueItems" in node
    ? node.maxUniqueItems
    : Number.POSITIVE_INFINITY;
  const uniqueItems = "uniqueItems" in node ? node.uniqueItems : false;
  return typeof minItems === "number" && Number.isSafeInteger(minItems) &&
    minItems >= 0 && minItems <= minimumRequested &&
    typeof maxItems === "number" &&
    (maxItems === Number.POSITIVE_INFINITY || Number.isSafeInteger(maxItems)) &&
    maxItems >= maximumRequested &&
    typeof minUniqueItems === "number" &&
    Number.isSafeInteger(minUniqueItems) && minUniqueItems >= 0 &&
    minUniqueItems <= minimumRequested &&
    typeof maxUniqueItems === "number" &&
    (maxUniqueItems === Number.POSITIVE_INFINITY ||
      Number.isSafeInteger(maxUniqueItems)) &&
    maxUniqueItems >= maximumRequested &&
    typeof uniqueItems === "boolean";
}

function businessSchemaAllowsSingleArrayItem(node: JsonRecord): boolean {
  return businessSchemaAllowsArrayLengthRange(node, 1, 1);
}

function businessSchemaAllowsObjectProperties(
  node: JsonRecord,
  propertyNames: readonly string[],
): boolean {
  if (
    propertyNames.length < 1 ||
    new Set(propertyNames).size !== propertyNames.length
  ) return false;
  const minProperties = "minProperties" in node ? node.minProperties : 0;
  const maxProperties = "maxProperties" in node
    ? node.maxProperties
    : Number.POSITIVE_INFINITY;
  const required = "required" in node ? node.required : [];
  const propertyCount = propertyNames.length;
  return typeof minProperties === "number" &&
    Number.isSafeInteger(minProperties) && minProperties >= 0 &&
    minProperties <= propertyCount &&
    typeof maxProperties === "number" &&
    (maxProperties === Number.POSITIVE_INFINITY ||
      Number.isSafeInteger(maxProperties)) && maxProperties >= propertyCount &&
    (!("additionalProperties" in node) ||
      typeof node.additionalProperties === "boolean") &&
    Array.isArray(required) &&
    required.every((value) =>
      typeof value === "string" && propertyNames.includes(value)
    );
}

function businessOfferAllowsExactProperties(
  node: JsonRecord,
  propertyNames: readonly string[],
): boolean {
  const properties = isRecord(node.properties) ? node.properties : null;
  return properties !== null &&
    propertyNames.every((propertyName) => propertyName in properties) &&
    businessSchemaAllowsObjectProperties(node, propertyNames) &&
    (!("additionalProperties" in node) ||
      typeof node.additionalProperties === "boolean");
}

// This deliberately small Draft 2019-09 evaluator is used only for the three
// string selectors that identify the B2B contribution. Every applicable
// selector constraint must be understood; an unknown one makes the branch
// read-only instead of being ignored.
function schemaExactStringConstraint(
  root: JsonRecord,
  node: unknown,
  expected: string,
  traversal: BusinessSchemaTraversal,
  seenRefs = new Set<string>(),
  depth = 0,
): ExactStringEvaluation {
  if (!consumeBusinessSchemaNode(traversal, depth)) {
    return { matches: null, constrained: false };
  }
  if (node === false) return { matches: false, constrained: true };
  if (node === true) return { matches: true, constrained: false };
  if (!isRecord(node)) {
    traversal.safe = false;
    return { matches: null, constrained: false };
  }

  const constraints: ExactStringEvaluation[] = [];
  if ("type" in node) {
    const types = Array.isArray(node.type) ? node.type : [node.type];
    constraints.push({
      matches: types.every((type) => typeof type === "string")
        ? types.includes("string")
        : null,
      constrained: true,
    });
  }
  if ("const" in node) {
    constraints.push({ matches: node.const === expected, constrained: true });
  }
  if ("enum" in node) {
    constraints.push({
      matches: Array.isArray(node.enum)
        ? node.enum.includes(expected)
        : null,
      constrained: true,
    });
  }
  const length = Array.from(expected).length;
  if ("minLength" in node) {
    const minLength = node.minLength;
    constraints.push({
      matches: typeof minLength === "number" &&
          Number.isSafeInteger(minLength) && minLength >= 0
        ? length >= minLength
        : null,
      constrained: true,
    });
  }
  if ("maxLength" in node) {
    const maxLength = node.maxLength;
    constraints.push({
      matches: typeof maxLength === "number" &&
          Number.isSafeInteger(maxLength) && maxLength >= 0
        ? length <= maxLength
        : null,
      constrained: true,
    });
  }
  const utf8Length = new TextEncoder().encode(expected).byteLength;
  if ("minUtf8ByteLength" in node) {
    const minUtf8ByteLength = node.minUtf8ByteLength;
    constraints.push({
      matches: typeof minUtf8ByteLength === "number" &&
          Number.isSafeInteger(minUtf8ByteLength) && minUtf8ByteLength >= 0
        ? utf8Length >= minUtf8ByteLength
        : null,
      constrained: true,
    });
  }
  if ("maxUtf8ByteLength" in node) {
    const maxUtf8ByteLength = node.maxUtf8ByteLength;
    constraints.push({
      matches: typeof maxUtf8ByteLength === "number" &&
          Number.isSafeInteger(maxUtf8ByteLength) && maxUtf8ByteLength >= 0
        ? utf8Length <= maxUtf8ByteLength
        : null,
      constrained: true,
    });
  }
  if ("pattern" in node) {
    let patternMatches: boolean | null = null;
    if (typeof node.pattern === "string") {
      try {
        patternMatches = new RegExp(node.pattern, "u").test(expected);
      } catch {
        patternMatches = null;
      }
    }
    constraints.push({ matches: patternMatches, constrained: true });
  }

  if (typeof node.$ref === "string") {
    if (seenRefs.has(node.$ref)) {
      traversal.exhausted = true;
      traversal.safe = false;
      return { matches: null, constrained: false };
    }
    constraints.push(schemaExactStringConstraint(
      root,
      jsonPointer(root, node.$ref),
      expected,
      traversal,
      new Set(seenRefs).add(node.$ref),
      depth + 1,
    ));
  }

  if ("allOf" in node && !Array.isArray(node.allOf)) {
    constraints.push({ matches: null, constrained: true });
  } else if (Array.isArray(node.allOf)) {
    if (!reserveBusinessSchemaCollection(traversal, node.allOf.length)) {
      constraints.push({ matches: null, constrained: true });
    } else {
      for (const branch of node.allOf) {
        if (traversal.exhausted) break;
        constraints.push(schemaExactStringConstraint(
          root,
          branch,
          expected,
          traversal,
          new Set(seenRefs),
          depth + 1,
        ));
      }
    }
  }

  for (const key of ["anyOf", "oneOf"] as const) {
    if (!(key in node)) continue;
    if (!Array.isArray(node[key])) {
      constraints.push({ matches: null, constrained: true });
      continue;
    }
    if (!reserveBusinessSchemaCollection(traversal, node[key].length)) {
      constraints.push({ matches: null, constrained: true });
      continue;
    }
    const branchResults: ExactStringEvaluation[] = [];
    for (const branch of node[key]) {
      if (traversal.exhausted) break;
      branchResults.push(schemaExactStringConstraint(
        root,
        branch,
        expected,
        traversal,
        new Set(seenRefs),
        depth + 1,
      ));
    }
    if (traversal.exhausted) {
      constraints.push({ matches: null, constrained: true });
      continue;
    }
    const matches = branchResults.filter((result) =>
      result.matches === true
    ).length;
    const unknown = branchResults.some((result) => result.matches === null);
    if (key === "oneOf") {
      constraints.push({
        matches: unknown ? null : matches === 1,
        constrained: true,
      });
    } else {
      constraints.push({
        matches: matches > 0 ? true : unknown ? null : false,
        constrained: branchResults.every((result) => result.constrained),
      });
    }
  }

  if ("not" in node) {
    const rejected = schemaExactStringConstraint(
      root,
      node.not,
      expected,
      traversal,
      new Set(seenRefs),
      depth + 1,
    );
    constraints.push({
      matches: rejected.matches === null ? null : !rejected.matches,
      constrained: true,
    });
  }
  if (
    "if" in node || "then" in node || "else" in node ||
    "dependentSchemas" in node || "dependentRequired" in node ||
    "format" in node || "contentEncoding" in node ||
    "contentMediaType" in node || "contentSchema" in node
  ) {
    constraints.push({ matches: null, constrained: true });
  }
  if (Object.keys(node).some((key) => !BUSINESS_SELECTOR_SCHEMA_KEYS.has(key))) {
    constraints.push({ matches: null, constrained: true });
  }

  return conjunctExactStringEvaluations(constraints.length > 0
    ? constraints
    : [{ matches: true, constrained: false }]);
}

function businessBranchAudienceEvaluation(
  root: JsonRecord,
  node: unknown,
  traversal: BusinessSchemaTraversal,
  seenRefs = new Set<string>(),
  depth = 0,
): ExactStringEvaluation {
  if (!consumeBusinessSchemaNode(traversal, depth)) {
    return { matches: null, constrained: false };
  }
  if (node === false) return { matches: false, constrained: true };
  if (node === true) return { matches: true, constrained: false };
  if (!isRecord(node)) {
    traversal.safe = false;
    return { matches: null, constrained: false };
  }
  if (!businessSchemaAllowsType(node, "object")) {
    return { matches: false, constrained: true };
  }
  if (
    "allOf" in node || "anyOf" in node || "oneOf" in node ||
    "if" in node || "then" in node || "else" in node || "not" in node ||
    "dependentSchemas" in node || "dependentRequired" in node
  ) {
    return { matches: null, constrained: false };
  }
  const evaluations: ExactStringEvaluation[] = [];
  if (isRecord(node.properties) && "audience" in node.properties) {
    evaluations.push(schemaExactStringConstraint(
      root,
      node.properties.audience,
      "B2B",
      traversal,
      new Set(seenRefs),
      depth + 1,
    ));
  }
  if (typeof node.$ref === "string") {
    if (seenRefs.has(node.$ref)) {
      traversal.exhausted = true;
      traversal.safe = false;
      return { matches: null, constrained: false };
    }
    evaluations.push(businessBranchAudienceEvaluation(
      root,
      jsonPointer(root, node.$ref),
      traversal,
      new Set(seenRefs).add(node.$ref),
      depth + 1,
    ));
  }
  return conjunctExactStringEvaluations(evaluations.length > 0
    ? evaluations
    : [{ matches: true, constrained: false }]);
}

function businessOfferPriceBranches(
  root: JsonRecord,
  node: unknown,
  selector: BusinessOfferSelector,
  traversal: BusinessSchemaTraversal,
  seenRefs = new Set<string>(),
  depth = 0,
  ancestors: readonly unknown[] = [],
  expectedType: "array" | "object" = "array",
): BusinessOfferPriceBranch[] {
  if (!consumeBusinessSchemaNode(traversal, depth)) {
    return [];
  }
  if (node === false) {
    traversal.safe = false;
    return [];
  }
  if (node === true || !isRecord(node)) {
    if (node !== true) traversal.safe = false;
    return [];
  }
  if (
    !businessSchemaAllowsType(node, expectedType) ||
    (expectedType === "array" && !businessSchemaAllowsSingleArrayItem(node))
  ) {
    traversal.safe = false;
    return [];
  }
  const currentPath = [...ancestors, node];
  const found: BusinessOfferPriceBranch[] = [];
  if (hasBusinessRefSiblings(node)) traversal.safe = false;
  if (Object.keys(node).some((key) => !BUSINESS_OFFER_SCHEMA_KEYS.has(key))) {
    traversal.safe = false;
  }
  if (
    "if" in node || "then" in node || "else" in node || "not" in node ||
    "dependentSchemas" in node || "dependentRequired" in node
  ) {
    traversal.safe = false;
  }
  const properties = isRecord(node.properties) ? node.properties : null;
  const audienceConstraint = properties && "audience" in properties
    ? schemaExactStringConstraint(
        root,
        properties.audience,
        selector.audience,
        traversal,
        new Set(seenRefs),
        depth + 1,
      )
    : null;
  const hasDirectOfferDefinition = expectedType === "object" && Boolean(
    properties && "audience" in properties && "our_price" in properties,
  );
  if (properties) {
    const partialSelectorOrPrice = [
      "audience",
      "currency",
      "marketplace_id",
      "our_price",
    ].some((key) => key in properties);
    if (partialSelectorOrPrice && !hasDirectOfferDefinition) {
      traversal.safe = false;
    }
  }
  if (
    hasDirectOfferDefinition &&
    ("$ref" in node || "allOf" in node || "anyOf" in node ||
      "oneOf" in node)
  ) {
    traversal.safe = false;
  }
  if (
    hasDirectOfferDefinition &&
    audienceConstraint?.matches === true &&
    audienceConstraint.constrained
  ) {
    const marketplaceConstraint = properties && "marketplace_id" in properties
      ? schemaExactStringConstraint(
          root,
          properties.marketplace_id,
          selector.marketplaceId,
          traversal,
          new Set(seenRefs),
          depth + 1,
        )
      : { matches: null, constrained: false };
    const currencyConstraint = properties && "currency" in properties
      ? schemaExactStringConstraint(
          root,
          properties.currency,
          selector.currencyCode,
          traversal,
          new Set(seenRefs),
          depth + 1,
        )
      : { matches: null, constrained: false };
    found.push({
      offerPath: currentPath,
      offerSchema: node,
      price: properties?.our_price,
      quantityDiscountPlan: properties?.quantity_discount_plan,
      selectorProven:
        marketplaceConstraint.matches === true &&
        marketplaceConstraint.constrained &&
        currencyConstraint.matches === true &&
        currencyConstraint.constrained,
    });
  }

  if (typeof node.$ref === "string") {
    if (seenRefs.has(node.$ref)) {
      traversal.exhausted = true;
      traversal.safe = false;
    } else {
      found.push(...businessOfferPriceBranches(
        root,
        jsonPointer(root, node.$ref),
        selector,
        traversal,
        new Set(seenRefs).add(node.$ref),
        depth + 1,
        currentPath,
        expectedType,
      ));
    }
  }
  if ("items" in node) {
    if (expectedType !== "array") {
      traversal.safe = false;
      return found;
    }
    const items = Array.isArray(node.items) ? node.items : [node.items];
    if (items.length !== 1) traversal.safe = false;
    if (!reserveBusinessSchemaCollection(traversal, items.length)) {
      return found;
    }
    for (const item of items) {
      if (traversal.exhausted) break;
      found.push(...businessOfferPriceBranches(
        root,
        item,
        selector,
        traversal,
        new Set(seenRefs),
        depth + 1,
        currentPath,
        "object",
      ));
    }
  }
  if ("allOf" in node) {
    traversal.safe = false;
    if (Array.isArray(node.allOf)) {
      if (!reserveBusinessSchemaCollection(traversal, node.allOf.length)) {
        return found;
      }
      for (const branch of node.allOf) {
        if (traversal.exhausted) break;
        found.push(...businessOfferPriceBranches(
          root,
          branch,
          selector,
          traversal,
          new Set(seenRefs),
          depth + 1,
          currentPath,
          expectedType,
        ));
      }
    }
  }
  for (const key of ["anyOf", "oneOf"] as const) {
    if (!(key in node)) continue;
    if (!Array.isArray(node[key])) {
      traversal.safe = false;
      continue;
    }
    if (!reserveBusinessSchemaCollection(traversal, node[key].length)) {
      continue;
    }
    const evaluated: Array<{
      branch: unknown;
      audience: ExactStringEvaluation;
    }> = [];
    for (const branch of node[key]) {
      if (traversal.exhausted) break;
      evaluated.push({
        branch,
        audience: businessBranchAudienceEvaluation(
        root,
        branch,
        traversal,
        new Set(seenRefs),
        depth + 1,
        ),
      });
    }
    if (traversal.exhausted) continue;
    const matching = evaluated.filter(({ audience }) =>
      audience.matches === true
    );
    const exact = matching.filter(({ audience }) => audience.constrained);
    const excluded = evaluated.filter(({ audience }) =>
      audience.matches === false
    );
    const uniquelySelected = exact.length === 1 && matching.length === 1 &&
      excluded.length === evaluated.length - 1;
    if (!uniquelySelected) traversal.safe = false;
    for (const { branch } of exact) {
      found.push(...businessOfferPriceBranches(
        root,
        branch,
        selector,
        traversal,
        new Set(seenRefs),
        depth + 1,
        currentPath,
        expectedType,
      ));
    }
  }
  return found;
}

function businessOfferAttributeSchemas(
  root: JsonRecord,
  traversal: BusinessSchemaTraversal,
): { schemas: unknown[]; safe: boolean } {
  const schemas: unknown[] = [];
  let safe = true;
  const walk = (
    node: unknown,
    seenRefs = new Set<string>(),
    depth = 0,
  ): void => {
    if (!consumeBusinessSchemaNode(traversal, depth)) return;
    if (node === false) {
      safe = false;
      traversal.safe = false;
      return;
    }
    if (!isRecord(node)) {
      if (node !== true) traversal.safe = false;
      return;
    }
    if (
      !businessSchemaAllowsType(node, "object") ||
      hasBusinessRefSiblings(node) ||
      Object.keys(node).some((key) =>
        !BUSINESS_ATTRIBUTE_ROOT_SCHEMA_KEYS.has(key)
      ) ||
      directEditableFlags(node).includes(false) ||
      ("properties" in node && !isRecord(node.properties)) ||
      ("required" in node &&
        (!Array.isArray(node.required) ||
          node.required.some((value) => typeof value !== "string"))) ||
      ("additionalProperties" in node &&
        typeof node.additionalProperties !== "boolean" &&
        !isRecord(node.additionalProperties))
    ) {
      safe = false;
      traversal.safe = false;
    }
    if (
      "if" in node || "then" in node || "else" in node || "not" in node ||
      "dependentSchemas" in node || "dependentRequired" in node ||
      "patternProperties" in node || "propertyNames" in node ||
      "unevaluatedProperties" in node
    ) {
      safe = false;
      traversal.safe = false;
    }
    if (
      isRecord(node.properties) &&
      "purchasable_offer" in node.properties
    ) {
      schemas.push(node.properties.purchasable_offer);
    }
    if (typeof node.$ref === "string") {
      if (seenRefs.has(node.$ref)) {
        traversal.exhausted = true;
        traversal.safe = false;
      } else {
        walk(
          jsonPointer(root, node.$ref),
          new Set(seenRefs).add(node.$ref),
          depth + 1,
        );
      }
    }
    if ("allOf" in node) {
      safe = false;
      traversal.safe = false;
    }
    if (Array.isArray(node.allOf)) {
      if (!reserveBusinessSchemaCollection(traversal, node.allOf.length)) {
        return;
      }
      for (const branch of node.allOf) {
        if (traversal.exhausted) break;
        walk(branch, new Set(seenRefs), depth + 1);
      }
    }
    if (Array.isArray(node.oneOf) || Array.isArray(node.anyOf)) {
      safe = false;
      traversal.safe = false;
    }
  };
  walk(root);
  return {
    schemas,
    safe: safe && traversal.safe && !traversal.exhausted,
  };
}

function businessSimpleSchemaChain(
  root: JsonRecord,
  node: unknown,
  traversal: BusinessSchemaTraversal,
  expectedType: BusinessStructuralType,
  expectedProperties: readonly string[] = [],
  expectedArrayLengthRange: readonly [number, number] = [1, 1],
  seenRefs = new Set<string>(),
  depth = 0,
): { nodes: JsonRecord[]; safe: boolean } {
  if (!consumeBusinessSchemaNode(traversal, depth)) {
    return { nodes: [], safe: false };
  }
  if (node === false || node === true || !isRecord(node)) {
    traversal.safe = false;
    return { nodes: [], safe: false };
  }
  let safe = true;
  if (
    !businessSchemaAllowsType(node, expectedType) ||
    (expectedType === "array" && !businessSchemaAllowsArrayLengthRange(
      node,
      expectedArrayLengthRange[0],
      expectedArrayLengthRange[1],
    )) ||
    (expectedType === "object" &&
      !businessSchemaAllowsObjectProperties(node, expectedProperties)) ||
    ((expectedType === "array" || expectedType === "object") &&
      ("const" in node || "enum" in node)) ||
    hasBusinessRefSiblings(node)
  ) {
    traversal.safe = false;
    safe = false;
  }
  if (
    Object.keys(node).some((key) =>
      !BUSINESS_PRICE_PATH_SCHEMA_KEYS.has(key)
    )
  ) {
    traversal.safe = false;
    safe = false;
  }
  if (
    "allOf" in node || "anyOf" in node || "oneOf" in node ||
    "if" in node || "then" in node || "else" in node || "not" in node ||
    "dependentSchemas" in node || "dependentRequired" in node
  ) {
    traversal.safe = false;
    safe = false;
  }
  const nodes = [node];
  if (typeof node.$ref === "string") {
    if (seenRefs.has(node.$ref)) {
      traversal.exhausted = true;
      traversal.safe = false;
      return { nodes, safe: false };
    }
    const referenced = businessSimpleSchemaChain(
      root,
      jsonPointer(root, node.$ref),
      traversal,
      expectedType,
      expectedProperties,
      expectedArrayLengthRange,
      new Set(seenRefs).add(node.$ref),
      depth + 1,
    );
    nodes.push(...referenced.nodes);
    safe &&= referenced.safe;
  }
  return { nodes, safe };
}

function businessSingleSchemaValue(
  root: JsonRecord,
  node: unknown,
  kind: "items" | "property",
  traversal: BusinessSchemaTraversal,
  propertyName?: string,
  expectedArrayLengthRange: readonly [number, number] = [1, 1],
): { value: unknown; nodes: JsonRecord[]; safe: boolean } {
  const expectedType = kind === "items" ? "array" : "object";
  const chain = businessSimpleSchemaChain(
    root,
    node,
    traversal,
    expectedType,
    kind === "property" && propertyName ? [propertyName] : [],
    expectedArrayLengthRange,
  );
  const values: unknown[] = [];
  for (const candidate of chain.nodes) {
    if (kind === "items") {
      if (!("items" in candidate)) continue;
      const candidateItems = Array.isArray(candidate.items)
        ? candidate.items
        : [candidate.items];
      if (
        candidateItems.length !== 1 ||
        !reserveBusinessSchemaCollection(traversal, candidateItems.length)
      ) {
        traversal.safe = false;
        continue;
      }
      values.push(candidateItems[0]);
      continue;
    }
    if (propertyName && isRecord(candidate.properties) &&
        propertyName in candidate.properties
    ) {
      values.push(candidate.properties[propertyName]);
    }
  }
  const safe = chain.safe && values.length === 1;
  if (!safe) traversal.safe = false;
  return { value: values[0], nodes: chain.nodes, safe };
}

function businessSchemaPropertyValues(
  root: JsonRecord,
  node: unknown,
  traversal: BusinessSchemaTraversal,
  propertyNames: readonly string[],
): {
  values: Readonly<Record<string, unknown>>;
  nodes: JsonRecord[];
  safe: boolean;
} {
  const chain = businessSimpleSchemaChain(
    root,
    node,
    traversal,
    "object",
    propertyNames,
  );
  const values = new Map<string, unknown[]>();
  for (const propertyName of propertyNames) values.set(propertyName, []);
  for (const candidate of chain.nodes) {
    if (!isRecord(candidate.properties)) continue;
    for (const propertyName of propertyNames) {
      if (propertyName in candidate.properties) {
        values.get(propertyName)!.push(candidate.properties[propertyName]);
      }
    }
  }
  const safe = chain.safe && propertyNames.every((propertyName) =>
    values.get(propertyName)?.length === 1
  );
  if (!safe) traversal.safe = false;
  return {
    values: Object.fromEntries(propertyNames.map((propertyName) => [
      propertyName,
      values.get(propertyName)?.[0],
    ])),
    nodes: chain.nodes,
    safe,
  };
}

function businessNumericSchemaAccepts(
  nodes: readonly JsonRecord[],
  value: number,
): boolean {
  for (const node of nodes) {
    if ("const" in node && node.const !== value) return false;
    if ("enum" in node &&
        (!Array.isArray(node.enum) || !node.enum.includes(value))) return false;
    for (const [key, predicate] of [
      ["minimum", (limit: number) => value >= limit],
      ["exclusiveMinimum", (limit: number) => value > limit],
      ["maximum", (limit: number) => value <= limit],
      ["exclusiveMaximum", (limit: number) => value < limit],
    ] as const) {
      if (!(key in node)) continue;
      const limit = node[key];
      if (typeof limit !== "number" || !Number.isFinite(limit) ||
          !predicate(limit)) return false;
    }
    if ("multipleOf" in node) {
      const multiple = node.multipleOf;
      if (typeof multiple !== "number" || !Number.isFinite(multiple) ||
          multiple <= 0) return false;
      const quotient = value / multiple;
      if (Math.abs(quotient - Math.round(quotient)) >
          Number.EPSILON * Math.max(1, Math.abs(quotient)) * 4) return false;
    }
  }
  return true;
}

function businessPriceBranchEditable(
  root: JsonRecord,
  branch: BusinessOfferPriceBranch,
  traversal: BusinessSchemaTraversal,
): boolean {
  if (!branch.selectorProven || !traversal.safe) return false;
  const pathNodes: JsonRecord[] = branch.offerPath.filter(isRecord);
  const priceItem = businessSingleSchemaValue(
    root,
    branch.price,
    "items",
    traversal,
  );
  pathNodes.push(...priceItem.nodes);
  if (!priceItem.safe) return false;
  const schedule = businessSingleSchemaValue(
    root,
    priceItem.value,
    "property",
    traversal,
    "schedule",
  );
  pathNodes.push(...schedule.nodes);
  if (!schedule.safe) return false;
  const scheduleItem = businessSingleSchemaValue(
    root,
    schedule.value,
    "items",
    traversal,
  );
  pathNodes.push(...scheduleItem.nodes);
  if (!scheduleItem.safe) return false;
  const valueWithTax = businessSingleSchemaValue(
    root,
    scheduleItem.value,
    "property",
    traversal,
    "value_with_tax",
  );
  pathNodes.push(...valueWithTax.nodes);
  if (!valueWithTax.safe) return false;
  const leaf = businessSimpleSchemaChain(
    root,
    valueWithTax.value,
    traversal,
    "number",
    [],
  );
  pathNodes.push(...leaf.nodes);
  if (!leaf.safe || !traversal.safe) return false;
  const flags = pathNodes.flatMap(directEditableFlags);
  // Amazon's PTD vocabulary uses an explicit negative annotation for fields
  // that cannot be edited. A missing positive `editable` annotation is not a
  // prohibition: the structurally valid proposal must still be decided by the
  // Listings Items Validation Preview before any write can proceed.
  return !flags.includes(false);
}

function businessQuantityDiscountBranchEditable(
  root: JsonRecord,
  branch: BusinessOfferPriceBranch,
  traversal: BusinessSchemaTraversal,
  proposedLevels: readonly BusinessQuantityDiscountLevel[] = [
    { lowerBound: 5, value: 5 },
    { lowerBound: 10, value: 10 },
    { lowerBound: 15, value: 15 },
    { lowerBound: 20, value: 20 },
  ],
): boolean {
  if (!branch.selectorProven || !traversal.safe) return false;
  const pathNodes: JsonRecord[] = branch.offerPath.filter(isRecord);
  const planItem = businessSingleSchemaValue(
    root,
    branch.quantityDiscountPlan,
    "items",
    traversal,
  );
  pathNodes.push(...planItem.nodes);
  if (!planItem.safe) return false;
  const schedule = businessSingleSchemaValue(
    root,
    planItem.value,
    "property",
    traversal,
    "schedule",
  );
  pathNodes.push(...schedule.nodes);
  if (!schedule.safe) return false;
  const scheduleItem = businessSingleSchemaValue(
    root,
    schedule.value,
    "items",
    traversal,
  );
  pathNodes.push(...scheduleItem.nodes);
  if (!scheduleItem.safe) return false;
  const scheduleFields = businessSchemaPropertyValues(
    root,
    scheduleItem.value,
    traversal,
    ["discount_type", "levels"],
  );
  pathNodes.push(...scheduleFields.nodes);
  if (!scheduleFields.safe) return false;
  const discountType = businessSimpleSchemaChain(
    root,
    scheduleFields.values.discount_type,
    traversal,
    "string",
  );
  pathNodes.push(...discountType.nodes);
  if (!discountType.safe) return false;
  const percent = schemaExactStringConstraint(
    root,
    scheduleFields.values.discount_type,
    "percent",
    traversal,
  );
  const percentExplicitlyDeclared = discountType.nodes.some((node) =>
    node.const === "percent" ||
    (Array.isArray(node.enum) && node.enum.includes("percent"))
  );
  if (percent.matches !== true || !percentExplicitlyDeclared) return false;
  const levelItem = businessSingleSchemaValue(
    root,
    scheduleFields.values.levels,
    "items",
    traversal,
    undefined,
    [1, 5],
  );
  pathNodes.push(...levelItem.nodes);
  if (!levelItem.safe) return false;
  const levelFields = businessSchemaPropertyValues(
    root,
    levelItem.value,
    traversal,
    ["lower_bound", "value"],
  );
  pathNodes.push(...levelFields.nodes);
  if (!levelFields.safe) return false;
  const lowerBound = businessSimpleSchemaChain(
    root,
    levelFields.values.lower_bound,
    traversal,
    "integer",
  );
  const value = businessSimpleSchemaChain(
    root,
    levelFields.values.value,
    traversal,
    "number",
  );
  pathNodes.push(...lowerBound.nodes, ...value.nodes);
  if (!lowerBound.safe || !value.safe || !traversal.safe) return false;
  if (
    !proposedLevels.every((level) =>
      businessNumericSchemaAccepts(lowerBound.nodes, level.lowerBound) &&
      businessNumericSchemaAccepts(value.nodes, level.value)
    )
  ) return false;
  const flags = pathNodes.flatMap(directEditableFlags);
  return !flags.includes(false);
}

export function evaluateBusinessPricingCapabilitySchema(
  schema: JsonRecord,
  checksum: string | null,
  expected: Readonly<{
    marketplaceId: MarketplaceId;
    currencyCode: string;
    proposedQuantityDiscountLevels?: readonly BusinessQuantityDiscountLevel[];
  }>,
): BusinessPricingCapability {
  const selector: BusinessOfferSelector = {
    audience: "B2B",
    marketplaceId: expected.marketplaceId,
    currencyCode: expected.currencyCode,
  };
  const proposedQuantityDiscountLevels =
    expected.proposedQuantityDiscountLevels;
  const traversal = newBusinessSchemaTraversal();
  const attributes = businessOfferAttributeSchemas(schema, traversal);
  if (attributes.schemas.length === 0) {
    return {
      supported: false,
      editable: false,
      reason: "Amazon seller-specific PTD 沒有提供 purchasable_offer。",
      quantityDiscountsSupported: false,
      quantityDiscountsEditable: false,
      quantityDiscountsReason:
        "Amazon seller-specific PTD 沒有提供 quantity_discount_plan。",
      schemaChecksum: checksum,
    };
  }
  const branchesByAttribute = attributes.schemas.map((attribute) =>
    businessOfferPriceBranches(
      schema,
      attribute,
      selector,
      traversal,
    )
  );
  const branches = branchesByAttribute.flat();
  if (branches.length === 0) {
    return {
      supported: false,
      editable: false,
      reason:
        "Amazon seller-specific PTD 未提供 B2B audience 或 Business Price 欄位；此帳號／站點／商品類型不可寫入。",
      quantityDiscountsSupported: false,
      quantityDiscountsEditable: false,
      quantityDiscountsReason:
        "Amazon seller-specific PTD 未提供可唯一選取的 B2B quantity_discount_plan。",
      schemaChecksum: checksum,
    };
  }
  const rootFlags = attributes.schemas.flatMap(directEditableFlags);
  const hasUncomposedAttributeConstraint =
    attributes.schemas.length > 1 &&
    branchesByAttribute.some((attributeBranches) =>
      attributeBranches.length === 0
    );
  const editable = attributes.safe && traversal.safe && !traversal.exhausted &&
    !rootFlags.includes(false) && !hasUncomposedAttributeConstraint &&
    branches.every((branch) =>
      businessOfferAllowsExactProperties(
        branch.offerSchema,
        BUSINESS_PRICE_ONLY_OFFER_PROPERTIES,
      ) &&
      businessPriceBranchEditable(schema, branch, traversal)
    ) && traversal.safe && !traversal.exhausted;
  const quantityDiscountsSupported = branches.every((branch) =>
    isRecord(branch.quantityDiscountPlan)
  );
  const quantityDiscountsEditable = editable && quantityDiscountsSupported &&
    branches.every((branch) =>
      businessOfferAllowsExactProperties(
        branch.offerSchema,
        BUSINESS_COMBINED_OFFER_PROPERTIES,
      ) &&
      businessQuantityDiscountBranchEditable(
        schema,
        branch,
        traversal,
        proposedQuantityDiscountLevels,
      )
    );
  return {
    supported: true,
    editable,
    reason: editable
      ? null
      : "Amazon seller-specific PTD 未能明確證明 B2B 價格可編輯。",
    quantityDiscountsSupported,
    quantityDiscountsEditable,
    quantityDiscountsReason: quantityDiscountsEditable
      ? null
      : "Amazon seller-specific PTD 未能明確證明數量折扣可編輯。",
    schemaChecksum: checksum,
  };
}
