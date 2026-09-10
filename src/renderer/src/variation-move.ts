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
  action?: VariationMoveAction;
  mode: "live" | "demo";
  marketplaceId: string;
  sellerSku: string;
  sourceParentSku: string | null;
  targetParentSku: string | null;
  productType: string;
  variationTheme: string | null;
  dimensionNames: string[];
  fields: VariationFieldView[];
  requiredFields: VariationFieldView[];
  requiredFieldChoices?: VariationFieldView[];
  preservedRequiredFields?: VariationFieldView[];
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
  changes?: Array<{
    name: string;
    label: string;
    before: unknown;
    after: unknown;
  }>;
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

export type VariationRecoveryIntent = Pick<VariationMoveResult,
  "action" | "sourceParentSku" | "targetParentSku">;

export type VariationMoveRecovery = {
  mode: "live" | "demo";
  marketplaceId: string;
  sellerSku: string;
  status: "none" | "pending" | "unknown" | "verified";
  action: VariationMoveAction | null;
  sourceParentSku: string | null;
  targetParentSku: string | null;
  observedParentSku: string | null;
  result: VariationMoveResult | null;
  notice: string;
};

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStrings(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
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
    ["string", "number", "integer", "boolean", "json"].includes(
      String(value.type),
    ) &&
    typeof value.required === "boolean" &&
    Array.isArray(value.enumValues) &&
    value.enumValues.every(
      (item) =>
        typeof item === "string" ||
        typeof item === "number" ||
        typeof item === "boolean",
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

export function parseVariationRequiredFields(
  raw: unknown,
): VariationFieldView[] | null {
  return Array.isArray(raw) && raw.length <= 100 && raw.every(isField)
    ? raw
    : null;
}

export function parseVariationPreservedRequiredFields(
  raw: unknown,
): VariationFieldView[] | null {
  const fields = parseVariationRequiredFields(raw);
  return fields && fields.length <= 30 &&
    new Set(fields.map((field) => field.name)).size === fields.length &&
    fields.every((field) => {
      const leaf = field.leaves[0];
      const value = field.values[0]?.value;
      return /^[a-z][a-z0-9_]{0,79}$/u.test(field.name) &&
        !field.editable && !field.jsonFallback &&
        field.values.length === 1 && field.leaves.length === 1 &&
        Object.keys(field.values[0]).every((key) => ["value", "marketplace_id", "language_tag"].includes(key)) &&
        leaf.path.length === 1 && leaf.path[0] === "value" &&
        leaf.currentValue !== null && leaf.currentValue === value &&
        (leaf.type === "integer" ? Number.isInteger(value) : typeof value === leaf.type) &&
        ((typeof value === "string" && Boolean(value.trim())) ||
          (typeof value === "number" && Number.isFinite(value)) ||
          typeof value === "boolean");
    })
    ? fields
    : null;
}

export function parseVariationMovePreparation(
  raw: unknown,
  expected: {
    marketplaceId: string;
    sellerSku: string;
    targetParentSku: string | null;
    action?: VariationMoveAction;
  },
): VariationMovePreparation {
  if (!isRecord(raw))
    throw new Error("本機 AMZ.API Bridge 回傳的變體準備資料格式不正確。");
  if (raw.requiredFields === undefined || raw.action === undefined) {
    throw new Error(
      "請更新 AMZ.API Notebook Key；目前版本尚未提供 Amazon 必填商品資料編輯，已停止寫入。",
    );
  }
  const dimensionNames = isStrings(raw.dimensionNames)
    ? raw.dimensionNames
    : null;
  const fields =
    Array.isArray(raw.fields) && raw.fields.every(isField) ? raw.fields : null;
  const requiredFields =
    Array.isArray(raw.requiredFields) && raw.requiredFields.every(isField)
      ? raw.requiredFields
      : null;
  const action = expected.action ?? "attach";
  if (
    (raw.mode !== "live" && raw.mode !== "demo") ||
    raw.marketplaceId !== expected.marketplaceId ||
    raw.sellerSku !== expected.sellerSku ||
    raw.action !== action ||
    (raw.sourceParentSku !== null && typeof raw.sourceParentSku !== "string") ||
    raw.targetParentSku !== expected.targetParentSku ||
    typeof raw.productType !== "string" ||
    !raw.productType.trim() ||
    (action === "attach"
      ? typeof raw.variationTheme !== "string" || !raw.variationTheme.trim()
      : raw.variationTheme !== null) ||
    !dimensionNames ||
    (action === "attach"
      ? !dimensionNames.length
      : dimensionNames.length !== 0) ||
    !fields ||
    !dimensionNames.every((name) =>
      fields.some((field) => field.name === name),
    ) ||
    typeof raw.preparedAt !== "string" ||
    !isStrings(raw.requestIds) ||
    typeof raw.writable !== "boolean" ||
    !isStrings(raw.blockers) ||
    !isStrings(raw.warnings) ||
    (raw.requiredFieldChoices !== undefined &&
      parseVariationRequiredFields(raw.requiredFieldChoices) === null) ||
    (raw.preservedRequiredFields !== undefined &&
      parseVariationPreservedRequiredFields(raw.preservedRequiredFields) === null) ||
    typeof raw.notice !== "string"
  ) {
    throw new Error(
      "本機 AMZ.API Bridge 回傳的變體準備資料不完整，已停止寫入。",
    );
  }
  if (!requiredFields) {
    throw new Error(
      "請更新 AMZ.API Notebook Key；目前版本尚未提供 Amazon 必填商品資料編輯，已停止寫入。",
    );
  }
  return raw as VariationMovePreparation;
}

export function parseVariationMovePreview(
  raw: unknown,
  expected: {
    action: VariationMoveAction;
    marketplaceId: string;
    sellerSku: string;
    preservedRequiredFields?: VariationFieldView[];
  },
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
    (raw.changes !== undefined &&
      (!Array.isArray(raw.changes) ||
        !raw.changes.every(
          (change) =>
            isRecord(change) &&
            typeof change.name === "string" &&
            typeof change.label === "string" &&
            "before" in change &&
            "after" in change,
        ))) ||
    typeof raw.notice !== "string"
  ) {
    throw new Error("Amazon 變體預檢回應不完整，已停止送出。");
  }
  if (raw.issues.some((issue) => issue.severity.toUpperCase() === "ERROR")) {
    throw new Error("Amazon 變體預檢尚未通過，已停止送出。");
  }
  const changes = (raw as VariationMovePreview).changes ?? [];
  for (const field of expected.preservedRequiredFields ?? []) {
    const matching = changes.filter((change) => change.name === field.name);
    const exactAnswer = (value: unknown) => {
      if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) return false;
      const row = value[0];
      const original = field.values[0];
      return Object.keys(row).length === Object.keys(original).length &&
        Object.entries(original).every(([key, item]) => row[key] === item);
    };
    if (matching.length !== 1 || !exactAnswer(matching[0].before) || !exactAnswer(matching[0].after)) {
      throw new Error("本次預檢未完整核對要保留的既有答案，已停止送出。");
    }
  }
  return raw as VariationMovePreview;
}

export function parseVariationMoveResult(
  raw: unknown,
  expected: {
    action: VariationMoveAction;
    marketplaceId: string;
    sellerSku: string;
  },
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

export function parseVariationMoveRecovery(raw: unknown, expected: {
  mode: "live" | "demo";
  marketplaceId: string;
  sellerSku: string;
  intent?: VariationRecoveryIntent;
}): VariationMoveRecovery {
  const fail = () => new Error("Amazon 變體回查資料不完整或與目前操作不符；請勿重送。");
  const nullableSku = (value: unknown) => value === null ||
    (typeof value === "string" && value.length > 0 && value.length <= 40 &&
      value.trim() === value && !/[\u0000-\u001f\u007f-\u009f]/u.test(value));
  const keys = ["mode", "marketplaceId", "sellerSku", "status", "action", "sourceParentSku", "targetParentSku", "observedParentSku", "result", "notice"];
  if (!isRecord(raw) || Object.keys(raw).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(raw, key)) ||
    raw.mode !== expected.mode || raw.marketplaceId !== expected.marketplaceId ||
    raw.sellerSku !== expected.sellerSku ||
    !["none", "pending", "unknown", "verified"].includes(String(raw.status)) ||
    ![null, "attach", "detach"].includes(raw.action as null | string) ||
    !nullableSku(raw.sourceParentSku) || !nullableSku(raw.targetParentSku) ||
    !nullableSku(raw.observedParentSku) || typeof raw.notice !== "string" || raw.notice.length > 1200 ||
    (raw.action === "attach" && (raw.sourceParentSku !== null || raw.targetParentSku === null)) ||
    (raw.action === "detach" && (raw.sourceParentSku === null || raw.targetParentSku !== null)) ||
    (raw.action === null && (raw.sourceParentSku !== null || raw.targetParentSku !== null))) throw fail();
  if (raw.status !== "verified") {
    if (raw.result !== null || (raw.status === "none" && raw.action !== null)) throw fail();
    return raw as VariationMoveRecovery;
  }
  if (raw.action === null || !isRecord(raw.result)) throw fail();
  const resultKeys = ["mode", "action", "status", "marketplaceId", "sellerSku", "sourceParentSku", "targetParentSku", "variationTheme", "verified", "completedAt", "submissionId", "requestId", "issues", "notice"];
  if (Object.keys(raw.result).length !== resultKeys.length || !resultKeys.every((key) => Object.hasOwn(raw.result as JsonRecord, key))) throw fail();
  const result = parseVariationMoveResult(raw.result, {
    action: raw.action as VariationMoveAction, marketplaceId: expected.marketplaceId, sellerSku: expected.sellerSku,
  });
  if (result.mode !== expected.mode || result.status !== (expected.mode === "live" ? "ACCEPTED" : "SIMULATED") ||
    result.sourceParentSku !== raw.sourceParentSku || result.targetParentSku !== raw.targetParentSku ||
    raw.observedParentSku !== raw.targetParentSku || !Number.isFinite(Date.parse(result.completedAt)) ||
    (raw.action === "detach" ? result.variationTheme !== null : !result.variationTheme?.trim()) ||
    result.issues.some((issue) => issue.severity.toUpperCase() === "ERROR") ||
    (expected.intent && (raw.action !== expected.intent.action ||
      raw.sourceParentSku !== expected.intent.sourceParentSku || raw.targetParentSku !== expected.intent.targetParentSku))) throw fail();
  return raw as VariationMoveRecovery;
}

export function initialVariationDimensionValues(
  preparation: VariationMovePreparation,
): Record<string, Array<Record<string, unknown>>> {
  return Object.fromEntries(
    [...preparation.fields, ...preparation.requiredFields].map((field) => [
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
  value: string | number | boolean | null;
}): Record<string, Array<Record<string, unknown>>> {
  const next = structuredClone(input.values);
  const row = next[input.fieldName]?.[0] ?? {};
  setNestedValue(row, input.path, input.value);
  next[input.fieldName] = [row];
  return next;
}

function nestedValue(root: unknown, path: string[]): unknown {
  return path.reduce<unknown>(
    (current, key) => (isRecord(current) ? current[key] : undefined),
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
    ([key, child]) =>
      !["marketplace_id", "language_tag"].includes(key) && valuePresent(child),
  );
}

export function missingVariationFields(
  preparation: VariationMovePreparation,
  values: Record<string, Array<Record<string, unknown>>>,
): string[] {
  return [...preparation.fields, ...preparation.requiredFields].flatMap(
    (field) => {
      const row = values[field.name]?.[0];
      if (!row || !valuePresent(row)) return [field.label];
      const missingLeaves = field.leaves
        .filter(
          (leaf) => leaf.required && !valuePresent(nestedValue(row, leaf.path)),
        )
        .map((leaf) => `${field.label} · ${leaf.label}`);
      return missingLeaves;
    },
  );
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
