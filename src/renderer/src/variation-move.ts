export type VariationMoveAction = "detach" | "attach";

export type VariationMoveIssue = {
  code: string | null;
  severity: string;
  message: string;
  attributeNames: string[];
};

export type VariationFieldLeafView = {
  path: string[];
  label: string;
  type: "string" | "number" | "integer" | "boolean" | "json";
  required: boolean;
  enumValues: Array<string | number | boolean>;
  currentValue: string | number | boolean | null;
};

export type VariationFieldView = {
  name: string;
  label: string;
  editable: boolean;
  values: Array<Record<string, unknown>>;
  leaves: VariationFieldLeafView[];
  jsonFallback: boolean;
};

export type VariationMovePreparation = {
  mode: "live" | "demo";
  marketplaceId: string;
  sellerSku: string;
  sourceParentSku: string | null;
  targetParentSku: string;
  productType: string;
  variationTheme: string;
  dimensionNames: string[];
  fields: VariationFieldView[];
  preparedAt: string;
  requestIds: string[];
  writable: boolean;
  blockers: string[];
  warnings: string[];
  notice: string;
};

export type VariationMovePreview = {
  mode: "live" | "demo";
  action: VariationMoveAction;
  status: "VALID" | "SIMULATED";
  marketplaceId: string;
  sellerSku: string;
  sourceParentSku: string | null;
  targetParentSku: string | null;
  variationTheme: string | null;
  validatedAt: string;
  issues: VariationMoveIssue[];
  notice: string;
};

export type VariationMoveResult = {
  mode: "live" | "demo";
  action: VariationMoveAction;
  status: "ACCEPTED" | "SIMULATED";
  marketplaceId: string;
  sellerSku: string;
  sourceParentSku: string | null;
  targetParentSku: string | null;
  variationTheme: string | null;
  verified: boolean;
  completedAt: string;
  submissionId: string | null;
  requestId: string | null;
  issues: VariationMoveIssue[];
  notice: string;
};

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isIssue(value: unknown): value is VariationMoveIssue {
  return (
    isRecord(value) &&
    (value.code === null || typeof value.code === "string") &&
    typeof value.severity === "string" &&
    typeof value.message === "string" &&
    isStrings(value.attributeNames)
  );
}

function isLeaf(value: unknown): value is VariationFieldLeafView {
  return (
    isRecord(value) &&
    isStrings(value.path) &&
    value.path.length > 0 &&
    typeof value.label === "string" &&
    ["string", "number", "integer", "boolean", "json"].includes(String(value.type)) &&
    typeof value.required === "boolean" &&
    Array.isArray(value.enumValues) &&
    value.enumValues.every((item) =>
      typeof item === "string" || typeof item === "number" || typeof item === "boolean"
    ) &&
    (value.currentValue === null ||
      typeof value.currentValue === "string" ||
      typeof value.currentValue === "number" ||
      typeof value.currentValue === "boolean")
  );
}

function isField(value: unknown): value is VariationFieldView {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    Boolean(value.name.trim()) &&
    typeof value.label === "string" &&
    typeof value.editable === "boolean" &&
    Array.isArray(value.values) &&
    value.values.every(isRecord) &&
    Array.isArray(value.leaves) &&
    value.leaves.every(isLeaf) &&
    typeof value.jsonFallback === "boolean"
  );
}

export function parseVariationMovePreparation(
  raw: unknown,
  expected: { marketplaceId: string; sellerSku: string; targetParentSku: string },
): VariationMovePreparation {
  if (!isRecord(raw)) throw new Error("本機 AMZ.API Bridge 回傳的變體準備資料格式不正確。");
  const dimensionNames = isStrings(raw.dimensionNames) ? raw.dimensionNames : null;
  const fields = Array.isArray(raw.fields) && raw.fields.every(isField)
    ? raw.fields
    : null;
  if (
    (raw.mode !== "live" && raw.mode !== "demo") ||
    raw.marketplaceId !== expected.marketplaceId ||
    raw.sellerSku !== expected.sellerSku ||
    (raw.sourceParentSku !== null && typeof raw.sourceParentSku !== "string") ||
    raw.targetParentSku !== expected.targetParentSku ||
    typeof raw.productType !== "string" ||
    !raw.productType.trim() ||
    typeof raw.variationTheme !== "string" ||
    !raw.variationTheme.trim() ||
    !dimensionNames ||
    !dimensionNames.length ||
    !fields ||
    !dimensionNames.every((name) => fields.some((field) => field.name === name)) ||
    typeof raw.preparedAt !== "string" ||
    !isStrings(raw.requestIds) ||
    typeof raw.writable !== "boolean" ||
    !isStrings(raw.blockers) ||
    !isStrings(raw.warnings) ||
    typeof raw.notice !== "string"
  ) {
    throw new Error("本機 AMZ.API Bridge 回傳的變體準備資料不完整，已停止寫入。");
  }
  return raw as VariationMovePreparation;
}

export function parseVariationMovePreview(
  raw: unknown,
  expected: { action: VariationMoveAction; marketplaceId: string; sellerSku: string },
): VariationMovePreview {
  if (
    !isRecord(raw) ||
    (raw.mode !== "live" && raw.mode !== "demo") ||
    raw.action !== expected.action ||
    (raw.status !== "VALID" && raw.status !== "SIMULATED") ||
    raw.marketplaceId !== expected.marketplaceId ||
    raw.sellerSku !== expected.sellerSku ||
    (raw.sourceParentSku !== null && typeof raw.sourceParentSku !== "string") ||
    (raw.targetParentSku !== null && typeof raw.targetParentSku !== "string") ||
    (raw.variationTheme !== null && typeof raw.variationTheme !== "string") ||
    typeof raw.validatedAt !== "string" ||
    !Array.isArray(raw.issues) ||
    !raw.issues.every(isIssue) ||
    typeof raw.notice !== "string"
  ) {
    throw new Error("Amazon 變體預檢回應不完整，已停止送出。");
  }
  return raw as VariationMovePreview;
}

export function parseVariationMoveResult(
  raw: unknown,
  expected: { action: VariationMoveAction; marketplaceId: string; sellerSku: string },
): VariationMoveResult {
  if (
    !isRecord(raw) ||
    (raw.mode !== "live" && raw.mode !== "demo") ||
    raw.action !== expected.action ||
    (raw.status !== "ACCEPTED" && raw.status !== "SIMULATED") ||
    raw.marketplaceId !== expected.marketplaceId ||
    raw.sellerSku !== expected.sellerSku ||
    (raw.sourceParentSku !== null && typeof raw.sourceParentSku !== "string") ||
    (raw.targetParentSku !== null && typeof raw.targetParentSku !== "string") ||
    (raw.variationTheme !== null && typeof raw.variationTheme !== "string") ||
    raw.verified !== true ||
    typeof raw.completedAt !== "string" ||
    (raw.submissionId !== null && typeof raw.submissionId !== "string") ||
    (raw.requestId !== null && typeof raw.requestId !== "string") ||
    !Array.isArray(raw.issues) ||
    !raw.issues.every(isIssue) ||
    typeof raw.notice !== "string"
  ) {
    throw new Error("Amazon 變體回查尚未證明完成；請勿直接重送。");
  }
  return raw as VariationMoveResult;
}

export function initialVariationDimensionValues(
  preparation: VariationMovePreparation,
): Record<string, Array<Record<string, unknown>>> {
  return Object.fromEntries(
    preparation.fields.map((field) => [
      field.name,
      field.values.length
        ? structuredClone(field.values)
        : [{ marketplace_id: preparation.marketplaceId }],
    ]),
  );
}

function setNestedValue(
  root: Record<string, unknown>,
  path: string[],
  value: unknown,
): void {
  let cursor = root;
  path.forEach((key, index) => {
    if (index === path.length - 1) {
      cursor[key] = value;
      return;
    }
    if (!isRecord(cursor[key])) cursor[key] = {};
    cursor = cursor[key] as Record<string, unknown>;
  });
}

export function updateVariationLeaf(input: {
  values: Record<string, Array<Record<string, unknown>>>;
  fieldName: string;
  path: string[];
  value: string | number | boolean;
}): Record<string, Array<Record<string, unknown>>> {
  const next = structuredClone(input.values);
  const row = next[input.fieldName]?.[0] ?? {};
  setNestedValue(row, input.path, input.value);
  next[input.fieldName] = [row];
  return next;
}

function nestedValue(root: unknown, path: string[]): unknown {
  return path.reduce<unknown>(
    (current, key) => isRecord(current) ? current[key] : undefined,
    root,
  );
}

function valuePresent(value: unknown): boolean {
  if (typeof value === "string") return Boolean(value.trim());
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.some(valuePresent);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(
    ([key, child]) => !["marketplace_id", "language_tag"].includes(key) && valuePresent(child),
  );
}

export function missingVariationFields(
  preparation: VariationMovePreparation,
  values: Record<string, Array<Record<string, unknown>>>,
): string[] {
  return preparation.fields.flatMap((field) => {
    const row = values[field.name]?.[0];
    if (!row || !valuePresent(row)) return [field.label];
    const missingLeaves = field.leaves
      .filter((leaf) => leaf.required && !valuePresent(nestedValue(row, leaf.path)))
      .map((leaf) => `${field.label} · ${leaf.label}`);
    return missingLeaves;
  });
}

export function parseVariationJsonValues(input: {
  text: string;
  marketplaceId: string;
}): Array<Record<string, unknown>> {
  let value: unknown;
  try {
    value = JSON.parse(input.text);
  } catch {
    throw new Error("JSON 格式不正確。");
  }
  if (!Array.isArray(value) || !value.length || !value.every(isRecord)) {
    throw new Error("變體欄位必須是至少一筆 Amazon attribute 物件陣列。");
  }
  return value.map((row) => {
    if (
      typeof row.marketplace_id === "string" &&
      row.marketplace_id !== input.marketplaceId
    ) {
      throw new Error("變體欄位 marketplace_id 與目前站點不一致。");
    }
    return { ...row, marketplace_id: input.marketplaceId };
  });
}
