export type VariationPatchOperation = {
  op: "add" | "replace" | "delete";
  path: string;
  value: unknown[];
};

export type VariationPatchBody = {
  productType: string;
  patches: VariationPatchOperation[];
};

export type VariationFieldLeaf = {
  path: string[];
  label: string;
  type: "string" | "number" | "integer" | "boolean" | "json";
  required: boolean;
  enumValues: Array<string | number | boolean>;
  currentValue: string | number | boolean | null;
};

export type VariationFieldDescriptor = {
  name: string;
  label: string;
  editable: boolean;
  values: Array<Record<string, unknown>>;
  leaves: VariationFieldLeaf[];
  jsonFallback: boolean;
};

export type VariationRelationshipSnapshot = {
  parentageLevel: string | null;
  parentSku: string | null;
  relationshipType: string | null;
  variationTheme: string | null;
};

type JsonRecord = Record<string, unknown>;

const RELATIONSHIP_ATTRIBUTES = [
  "child_parent_sku_relationship",
  "parentage_level",
  "variation_theme",
] as const;

const HIDDEN_CONTEXT_KEYS = new Set(["marketplace_id", "language_tag"]);
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_ATTRIBUTE_JSON_BYTES = 24_000;

export class VariationUpdateValidationError extends Error {
  readonly code: string;

  constructor(message: string, code = "INVALID_VARIATION_DATA") {
    super(message);
    this.name = "VariationUpdateValidationError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function titleCase(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function jsonPointer(root: JsonRecord, reference: string): unknown {
  if (!reference.startsWith("#/")) return undefined;
  return reference
    .slice(2)
    .split("/")
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))
    .reduce<unknown>(
      (current, part) => (isRecord(current) ? current[part] : undefined),
      root,
    );
}

function schemaCandidates(
  root: JsonRecord,
  value: unknown,
  seen = new Set<string>(),
): JsonRecord[] {
  if (!isRecord(value)) return [];
  const candidates = [value];
  if (typeof value.$ref === "string" && !seen.has(value.$ref)) {
    const nextSeen = new Set(seen).add(value.$ref);
    candidates.push(
      ...schemaCandidates(root, jsonPointer(root, value.$ref), nextSeen),
    );
  }
  for (const key of ["allOf", "anyOf", "oneOf"] as const) {
    if (!Array.isArray(value[key])) continue;
    for (const branch of value[key]) {
      candidates.push(...schemaCandidates(root, branch, new Set(seen)));
    }
  }
  return candidates;
}

function schemaProperty(
  root: JsonRecord,
  node: unknown,
  propertyName: string,
): unknown {
  for (const candidate of schemaCandidates(root, node)) {
    if (isRecord(candidate.properties) && propertyName in candidate.properties) {
      return candidate.properties[propertyName];
    }
  }
  return undefined;
}

function schemaValue(root: JsonRecord, node: unknown, key: string): unknown {
  for (const candidate of schemaCandidates(root, node)) {
    if (key in candidate) return candidate[key];
  }
  return undefined;
}

function schemaProperties(root: JsonRecord, node: unknown): JsonRecord {
  const properties: JsonRecord = {};
  for (const candidate of schemaCandidates(root, node)) {
    if (!isRecord(candidate.properties)) continue;
    Object.assign(properties, candidate.properties);
  }
  return properties;
}

function schemaRequired(root: JsonRecord, node: unknown): Set<string> {
  return new Set(
    schemaCandidates(root, node).flatMap((candidate) =>
      Array.isArray(candidate.required)
        ? candidate.required.filter(
            (value): value is string => typeof value === "string",
          )
        : [],
    ),
  );
}

function scalarType(
  root: JsonRecord,
  node: unknown,
): VariationFieldLeaf["type"] {
  const type = schemaValue(root, node, "type");
  if (
    type === "string" ||
    type === "number" ||
    type === "integer" ||
    type === "boolean"
  ) {
    return type;
  }
  return "json";
}

function leafValue(
  value: unknown,
): VariationFieldLeaf["currentValue"] {
  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
    ? value
    : null;
}

function collectLeaves(input: {
  root: JsonRecord;
  node: unknown;
  current: unknown;
  parentPath: string[];
  required: boolean;
  depth?: number;
}): VariationFieldLeaf[] {
  const depth = input.depth ?? 0;
  if (depth > 4) return [];
  const properties = schemaProperties(input.root, input.node);
  const propertyEntries = Object.entries(properties).filter(
    ([name]) => !HIDDEN_CONTEXT_KEYS.has(name),
  );
  if (!propertyEntries.length) {
    const enumValues = schemaCandidates(input.root, input.node)
      .flatMap((candidate) => (Array.isArray(candidate.enum) ? candidate.enum : []))
      .filter(
        (value): value is string | number | boolean =>
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean",
      );
    return [
      {
        path: input.parentPath,
        label: titleCase(input.parentPath.at(-1) ?? "value"),
        type: scalarType(input.root, input.node),
        required: input.required,
        enumValues: [...new Set(enumValues)],
        currentValue: leafValue(input.current),
      },
    ];
  }

  const requiredNames = schemaRequired(input.root, input.node);
  return propertyEntries.flatMap(([name, child]) =>
    collectLeaves({
      root: input.root,
      node: child,
      current: isRecord(input.current) ? input.current[name] : undefined,
      parentPath: [...input.parentPath, name],
      required: input.required || requiredNames.has(name),
      depth: depth + 1,
    }),
  );
}

function cloneRecord(value: JsonRecord): JsonRecord {
  return structuredClone(value);
}

function assertSafeJson(value: unknown, depth = 0): void {
  if (depth > 8) {
    throw new VariationUpdateValidationError("變體欄位資料層級過深，已停止送出。");
  }
  if (Array.isArray(value)) {
    if (value.length > 30) {
      throw new VariationUpdateValidationError("單一變體欄位值過多，已停止送出。");
    }
    value.forEach((item) => assertSafeJson(item, depth + 1));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new VariationUpdateValidationError("變體欄位包含不允許的鍵值。");
    }
    assertSafeJson(child, depth + 1);
  }
}

function attributeObjects(
  attributes: Record<string, unknown> | undefined,
  name: string,
  marketplaceId: string,
): JsonRecord[] {
  const raw = attributes?.[name];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isRecord)
    .filter((item) => {
      const itemMarketplace = cleanText(item.marketplace_id);
      return !itemMarketplace || itemMarketplace === marketplaceId;
    })
    .map(cloneRecord);
}

function hasMeaningfulValue(value: unknown): boolean {
  if (typeof value === "string") return Boolean(value.trim());
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.some(hasMeaningfulValue);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(
    ([key, child]) => !HIDDEN_CONTEXT_KEYS.has(key) && hasMeaningfulValue(child),
  );
}

function nestedTexts(values: JsonRecord[], ...paths: string[][]): string[] {
  return unique(
    values.flatMap((value) =>
      paths.flatMap((path) => {
        let current: unknown = value;
        for (const key of path) {
          current = isRecord(current) ? current[key] : undefined;
        }
        const text = cleanText(current);
        return text ? [text] : [];
      }),
    ),
  );
}

function singleRelationshipValue(input: {
  values: JsonRecord[];
  label: string;
  paths: string[][];
}): string | null {
  const values = nestedTexts(input.values, ...input.paths);
  if (values.length > 1) {
    throw new VariationUpdateValidationError(
      `${input.label} 同時出現互相衝突的 Amazon 舊值，已停止變體操作。`,
      "VARIATION_RELATIONSHIP_CONFLICT",
    );
  }
  return values[0] ?? null;
}

function canonicalDimensionValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map(canonicalDimensionValue)
      .sort(compareCanonicalValues);
  }
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => !HIDDEN_CONTEXT_KEYS.has(key))
      .sort()
      .map((key) => [key, canonicalDimensionValue(value[key])]),
  );
}

function canonicalSortKey(value: unknown): string {
  return JSON.stringify(value) ?? "null";
}

function compareCanonicalValues(left: unknown, right: unknown): number {
  const a = canonicalSortKey(left);
  const b = canonicalSortKey(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function normalizeAttributeValues(input: {
  name: string;
  values: unknown;
  marketplaceId: string;
}): JsonRecord[] {
  if (!Array.isArray(input.values) || input.values.length < 1) {
    throw new VariationUpdateValidationError(
      `${input.name} 是目標變體必填欄位，請填寫完整資料。`,
      "VARIATION_FIELD_REQUIRED",
    );
  }
  assertSafeJson(input.values);
  if (new TextEncoder().encode(JSON.stringify(input.values)).byteLength > MAX_ATTRIBUTE_JSON_BYTES) {
    throw new VariationUpdateValidationError(`${input.name} 的資料超過安全上限。`);
  }
  const values = input.values.map((value) => {
    if (!isRecord(value)) {
      throw new VariationUpdateValidationError(
        `${input.name} 必須是 Amazon attribute 物件陣列。`,
      );
    }
    const marketplace = cleanText(value.marketplace_id);
    if (marketplace && marketplace !== input.marketplaceId) {
      throw new VariationUpdateValidationError(
        `${input.name} 的 marketplace_id 與目前站點不一致。`,
      );
    }
    return {
      ...cloneRecord(value),
      marketplace_id: input.marketplaceId,
    };
  });
  if (!values.some(hasMeaningfulValue)) {
    throw new VariationUpdateValidationError(
      `${input.name} 是目標變體必填欄位，不能只保留站點資訊。`,
      "VARIATION_FIELD_REQUIRED",
    );
  }
  return values;
}

export function variationFieldDescriptors(input: {
  productTypeDefinition: unknown;
  dimensionNames: string[];
  attributes?: Record<string, unknown>;
  marketplaceId: string;
}): VariationFieldDescriptor[] {
  if (!isRecord(input.productTypeDefinition)) {
    throw new VariationUpdateValidationError(
      "Amazon PTD 回應格式無效，無法確認變體必填欄位。",
      "PTD_UNAVAILABLE",
    );
  }
  const names = unique(input.dimensionNames.map((name) => name.trim()));
  if (!names.length) {
    throw new VariationUpdateValidationError(
      "目標 parent 沒有可確認的變體維度，已停止加入。",
      "VARIATION_DIMENSIONS_UNKNOWN",
    );
  }
  return names.map((name) => {
    const attributeSchema = schemaProperty(
      input.productTypeDefinition as JsonRecord,
      input.productTypeDefinition,
      name,
    );
    if (!attributeSchema) {
      throw new VariationUpdateValidationError(
        `Amazon CHILD PTD 沒有 ${name} 欄位，已停止加入。`,
        "VARIATION_SCHEMA_MISMATCH",
      );
    }
    const itemSchema = schemaValue(
      input.productTypeDefinition as JsonRecord,
      attributeSchema,
      "items",
    );
    const editable = ![attributeSchema, itemSchema]
      .flatMap((node) => schemaCandidates(input.productTypeDefinition as JsonRecord, node))
      .some((candidate) => candidate.editable === false);
    const values = attributeObjects(
      input.attributes,
      name,
      input.marketplaceId,
    );
    const leaves = collectLeaves({
      root: input.productTypeDefinition as JsonRecord,
      node: itemSchema,
      current: values[0],
      parentPath: [],
      required: false,
    }).filter((leaf) => leaf.path.length > 0);
    return {
      name,
      label: titleCase(name),
      editable,
      values,
      leaves,
      jsonFallback:
        leaves.length === 0 || leaves.some((leaf) => leaf.type === "json"),
    };
  });
}

export function buildVariationDetachBody(input: {
  productType: string;
  marketplaceId: string;
  expectedParentSku?: string | null;
  attributes?: Record<string, unknown>;
}): VariationPatchBody {
  const productType = input.productType.trim();
  if (!productType) {
    throw new VariationUpdateValidationError("來源 SKU 缺少 Amazon product type。");
  }
  const snapshot = variationRelationshipSnapshot({
    marketplaceId: input.marketplaceId,
    attributes: input.attributes,
  });
  if (
    snapshot.parentageLevel?.toLowerCase() !== "child" ||
    !snapshot.parentSku ||
    snapshot.relationshipType?.toLowerCase() !== "variation" ||
    !snapshot.variationTheme ||
    (input.expectedParentSku && snapshot.parentSku !== input.expectedParentSku.trim())
  ) {
    throw new VariationUpdateValidationError(
      "來源 SKU 的 parent、child 關係或 variation theme 與查詢結果不一致，不能安全解除變體。",
      "VARIATION_RELATIONSHIP_CHANGED",
    );
  }
  const patches = RELATIONSHIP_ATTRIBUTES.map((name) => {
    const values = attributeObjects(input.attributes, name, input.marketplaceId);
    if (!values.length) {
      throw new VariationUpdateValidationError(
        `來源 SKU 缺少可核對的 ${name} 舊值，不能安全解除變體。`,
        "VARIATION_RELATIONSHIP_CHANGED",
      );
    }
    return {
      op: "delete" as const,
      path: `/attributes/${name}`,
      value: values,
    };
  });
  return { productType, patches };
}

export function buildVariationAttachBody(input: {
  productType: string;
  marketplaceId: string;
  targetParentSku: string;
  variationTheme: string;
  dimensionNames: string[];
  dimensionValues: Record<string, unknown>;
  existingAttributes?: Record<string, unknown>;
}): VariationPatchBody {
  const productType = input.productType.trim();
  const targetParentSku = input.targetParentSku.trim();
  const variationTheme = input.variationTheme.trim();
  if (!productType || !targetParentSku || !variationTheme) {
    throw new VariationUpdateValidationError(
      "加入變體前必須確認 product type、目標 parent 與 variation theme。",
    );
  }
  const remainingRelationshipAttributes = RELATIONSHIP_ATTRIBUTES.filter(
    (name) =>
      attributeObjects(input.existingAttributes, name, input.marketplaceId)
        .length > 0,
  );
  if (remainingRelationshipAttributes.length) {
    throw new VariationUpdateValidationError(
      `此 SKU 仍有變體關係欄位（${remainingRelationshipAttributes.join("、")}）；請先完成解除並回讀確認。`,
      "VARIATION_NOT_DETACHED",
    );
  }
  const dimensionNames = unique(
    input.dimensionNames.map((name) => name.trim()),
  );
  if (!dimensionNames.length) {
    throw new VariationUpdateValidationError(
      "目標 parent 沒有可確認的必要變體維度。",
      "VARIATION_DIMENSIONS_UNKNOWN",
    );
  }
  const relationshipDimension = dimensionNames.find((name) =>
    (RELATIONSHIP_ATTRIBUTES as readonly string[]).includes(name),
  );
  if (relationshipDimension) {
    throw new VariationUpdateValidationError(
      `Amazon CHILD PTD 把關係欄位 ${relationshipDimension} 列為變體維度，已停止避免重複 patch。`,
      "VARIATION_SCHEMA_MISMATCH",
    );
  }
  const patches: VariationPatchOperation[] = [
    {
      op: "add",
      path: "/attributes/parentage_level",
      value: [{ marketplace_id: input.marketplaceId, value: "child" }],
    },
    {
      op: "add",
      path: "/attributes/child_parent_sku_relationship",
      value: [
        {
          marketplace_id: input.marketplaceId,
          child_relationship_type: "variation",
          parent_sku: targetParentSku,
        },
      ],
    },
    {
      op: "add",
      path: "/attributes/variation_theme",
      value: [{ marketplace_id: input.marketplaceId, name: variationTheme }],
    },
  ];
  for (const name of dimensionNames) {
    const values = normalizeAttributeValues({
      name,
      values: input.dimensionValues[name],
      marketplaceId: input.marketplaceId,
    });
    const existing = attributeObjects(
      input.existingAttributes,
      name,
      input.marketplaceId,
    );
    patches.push({
      op: existing.length ? "replace" : "add",
      path: `/attributes/${name}`,
      value: values,
    });
  }
  return { productType, patches };
}

export function variationDimensionSignature(input: {
  dimensionNames: string[];
  dimensionValues: Record<string, unknown>;
  marketplaceId: string;
}): string {
  const normalized = unique(input.dimensionNames.map((name) => name.trim()))
    .sort()
    .map((name) => [
      name,
      normalizeAttributeValues({
        name,
        values: input.dimensionValues[name],
        marketplaceId: input.marketplaceId,
      }).map(canonicalDimensionValue)
        .sort(compareCanonicalValues),
    ]);
  return JSON.stringify(normalized);
}

export function variationRelationshipSnapshot(input: {
  marketplaceId: string;
  attributes?: Record<string, unknown>;
}): VariationRelationshipSnapshot {
  const parentage = attributeObjects(
    input.attributes,
    "parentage_level",
    input.marketplaceId,
  );
  const relationship = attributeObjects(
    input.attributes,
    "child_parent_sku_relationship",
    input.marketplaceId,
  );
  const theme = attributeObjects(
    input.attributes,
    "variation_theme",
    input.marketplaceId,
  );
  const snapshot = {
    parentageLevel: singleRelationshipValue({
      values: parentage,
      label: "parentage_level",
      paths: [["value"]],
    }),
    parentSku: singleRelationshipValue({
      values: relationship,
      label: "child_parent_sku_relationship.parent_sku",
      paths: [["parent_sku"], ["value", "parent_sku"]],
    }),
    relationshipType: singleRelationshipValue({
      values: relationship,
      label: "child_parent_sku_relationship.child_relationship_type",
      paths: [
        ["child_relationship_type"],
        ["value", "child_relationship_type"],
      ],
    }),
    variationTheme: singleRelationshipValue({
      values: theme,
      label: "variation_theme",
      paths: [["name"], ["value"], ["value", "name"]],
    }),
  };
  if (
    snapshot.parentageLevel &&
    snapshot.parentageLevel.toLowerCase() !== "child" &&
    (snapshot.parentSku || snapshot.relationshipType)
  ) {
    throw new VariationUpdateValidationError(
      "parentage_level 與 child parent 關係互相衝突，已停止變體操作。",
      "VARIATION_RELATIONSHIP_CONFLICT",
    );
  }
  return snapshot;
}

export function assertVariationDetached(input: {
  marketplaceId: string;
  attributes?: Record<string, unknown>;
}): VariationRelationshipSnapshot {
  const snapshot = variationRelationshipSnapshot(input);
  const remaining = RELATIONSHIP_ATTRIBUTES.filter(
    (name) => attributeObjects(input.attributes, name, input.marketplaceId).length > 0,
  );
  if (remaining.length) {
    throw new VariationUpdateValidationError(
      `Amazon 回查仍有變體關係欄位：${remaining.join("、")}。請勿直接重送。`,
      "VARIATION_DETACH_NOT_VERIFIED",
    );
  }
  return snapshot;
}

export function assertVariationAttached(input: {
  marketplaceId: string;
  targetParentSku: string;
  variationTheme: string;
  dimensionNames: string[];
  dimensionValues: Record<string, unknown>;
  attributes?: Record<string, unknown>;
}): VariationRelationshipSnapshot {
  const expectedParent = input.targetParentSku.trim();
  const expectedTheme = input.variationTheme.trim();
  const snapshot = variationRelationshipSnapshot(input);
  if (
    snapshot.parentageLevel?.toLowerCase() !== "child" ||
    snapshot.parentSku !== expectedParent ||
    snapshot.relationshipType?.toLowerCase() !== "variation" ||
    snapshot.variationTheme !== expectedTheme
  ) {
    throw new VariationUpdateValidationError(
      "Amazon 回查的 parent、child 關係或 variation theme 與本次要求不一致。請勿直接重送。",
      "VARIATION_ATTACH_NOT_VERIFIED",
    );
  }
  const actualValues = Object.fromEntries(
    unique(input.dimensionNames.map((name) => name.trim())).map((name) => [
      name,
      attributeObjects(input.attributes, name, input.marketplaceId),
    ]),
  );
  let actualSignature: string;
  let expectedSignature: string;
  try {
    actualSignature = variationDimensionSignature({
      dimensionNames: input.dimensionNames,
      dimensionValues: actualValues,
      marketplaceId: input.marketplaceId,
    });
    expectedSignature = variationDimensionSignature({
      dimensionNames: input.dimensionNames,
      dimensionValues: input.dimensionValues,
      marketplaceId: input.marketplaceId,
    });
  } catch {
    throw new VariationUpdateValidationError(
      "Amazon 回查缺少本次要求的變體維度值。請勿直接重送。",
      "VARIATION_ATTACH_NOT_VERIFIED",
    );
  }
  if (actualSignature !== expectedSignature) {
    throw new VariationUpdateValidationError(
      "Amazon 回查的變體維度值與本次要求不一致。請勿直接重送。",
      "VARIATION_ATTACH_NOT_VERIFIED",
    );
  }
  return snapshot;
}
