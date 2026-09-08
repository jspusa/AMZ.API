import { createHash } from "node:crypto";
import {
  variationFieldDescriptors,
  VariationUpdateValidationError,
  type VariationFieldDescriptor, type VariationPatchOperation,
} from "./variation-update";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => Boolean(value) &&
  typeof value === "object" && !Array.isArray(value);
const contextKeys = new Set(["marketplace_id", "language_tag"]);
const protectedNames = new Set([
  "parentage_level", "child_parent_sku_relationship", "variation_theme",
  "purchasable_offer", "fulfillment_availability", "merchant_shipping_group",
  "item_name", "bullet_point", "product_description", "generic_keyword",
  "list_price", "standard_price", "sale_price", "minimum_advertised_price", "business_price", "condition_note",
  "main_product_image_locator", "externally_assigned_product_identifier",
  "merchant_suggested_asin", "supplier_declared_has_product_identifier_exemption",
]);
const labels: Record<string, string> = {
  contains_liquid: "產品是否含液體", product_contains_liquid: "產品是否含液體",
  is_liquid_double_sealed: "液體是否採雙重密封", batteries_required: "是否需要電池",
  batteries_included: "是否含電池", is_expiration_dated_product: "是否有產品效期",
  item_form: "產品形態", unit_count: "商品數量", country_of_origin: "原產地",
  supplier_declared_dg_hz_regulation: "危險品規範聲明",
};

function fail(message: string): never {
  throw new VariationUpdateValidationError(message, "VARIATION_REQUIRED_FIELDS_INVALID");
}

function resolved(root: RecordValue, node: unknown, depth = 0): RecordValue {
  if (!record(node) || depth > 12) return {};
  if (typeof node.$ref !== "string") return node;
  if (!node.$ref.startsWith("#/")) return {};
  let target: unknown = root;
  for (const part of node.$ref.slice(2).split("/")) {
    const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
    target = record(target) && Object.hasOwn(target, key) ? target[key] : undefined;
  }
  return { ...resolved(root, target, depth + 1), ...Object.fromEntries(
    Object.entries(node).filter(([key]) => key !== "$ref"),
  ) };
}

/** Evaluate only supported PTD predicates; unknown predicates never grant fields. */
function matches(root: RecordValue, schema: unknown, value: unknown, depth = 0): boolean | null {
  if (schema === true) return true;
  if (schema === false) return false;
  if (!record(schema) || depth > 12) return null;
  const node = resolved(root, schema);
  const supported = new Set(["$ref", "$comment", "title", "description", "type", "const", "enum",
    "required", "properties", "items", "contains", "minContains", "maxContains", "allOf", "anyOf", "oneOf", "not"]);
  if (Object.keys(node).some((key) => !supported.has(key))) return null;
  const checks: Array<boolean | null> = [];
  if (Object.hasOwn(node, "const")) checks.push(JSON.stringify(value) === JSON.stringify(node.const));
  if (Array.isArray(node.enum)) checks.push(node.enum.some((entry) => JSON.stringify(entry) === JSON.stringify(value)));
  if (typeof node.type === "string") checks.push(node.type === "array" ? Array.isArray(value) :
    node.type === "object" ? record(value) : node.type === "integer" ? Number.isInteger(value) : typeof value === node.type);
  if (Array.isArray(node.required) && record(value)) checks.push(node.required.every((key) => typeof key === "string" && Object.hasOwn(value, key)));
  if (record(node.properties) && record(value)) for (const [key, child] of Object.entries(node.properties)) {
    if (Object.hasOwn(value, key)) checks.push(matches(root, child, value[key], depth + 1));
  }
  if (node.items && Array.isArray(value)) for (const child of value) checks.push(matches(root, node.items, child, depth + 1));
  if (node.contains && Array.isArray(value)) {
    const results = value.map((child) => matches(root, node.contains, child, depth + 1));
    const count = results.filter((result) => result === true).length;
    checks.push(results.includes(null) ? null : count >= (typeof node.minContains === "number" ? node.minContains : 1) &&
      count <= (typeof node.maxContains === "number" ? node.maxContains : Infinity));
  }
  for (const key of ["allOf", "anyOf", "oneOf"] as const) if (Array.isArray(node[key])) {
    const results = node[key].map((child) => matches(root, child, value, depth + 1));
    checks.push(key === "allOf" ? results.includes(false) ? false : results.includes(null) ? null : true :
      key === "anyOf" ? results.includes(true) ? true : results.includes(null) ? null : false :
        results.includes(null) ? null : results.filter(Boolean).length === 1);
  }
  if (node.not) { const result = matches(root, node.not, value, depth + 1); checks.push(result === null ? null : !result); }
  return checks.includes(false) ? false : checks.includes(null) ? null : true;
}

function requiredNames(root: RecordValue, value: unknown): string[] {
  const names = new Set<string>();
  let budget = 2_000;
  const visit = (schema: unknown, depth = 0) => {
    if (--budget < 0 || depth > 12) fail("Amazon 必填欄位規則超過安全上限，請重新讀取。");
    const node = resolved(root, schema);
    if (Array.isArray(node.required)) for (const name of node.required) {
      if (typeof name === "string" && /^[a-z][a-z0-9_]{0,79}$/u.test(name)) names.add(name);
    }
    if (Array.isArray(node.allOf)) node.allOf.forEach((child) => visit(child, depth + 1));
    if (node.if) {
      const result = matches(root, node.if, value);
      if (result === true && node.then) visit(node.then, depth + 1);
      if (result === false && node.else) visit(node.else, depth + 1);
    }
    for (const key of ["anyOf", "oneOf"] as const) if (Array.isArray(node[key])) {
      const branches = node[key].filter((child) => matches(root, child, value) === true);
      if (branches.length === 1) visit(branches[0], depth + 1);
    }
  };
  visit(root);
  return [...names];
}

/** An Amazon issue can select a conditional requirement only if this exact PTD declares it. */
export function ptdDeclaredRequiredNames(schema: unknown): Set<string> {
  const names = new Set<string>();
  if (!record(schema)) return names;
  let budget = 2_000;
  const visit = (candidate: unknown, depth = 0) => {
    if (--budget < 0 || depth > 12) return;
    const node = resolved(schema, candidate);
    if (Array.isArray(node.required)) for (const name of node.required) {
      if (typeof name === "string" && /^[a-z][a-z0-9_]{0,79}$/u.test(name)) names.add(name);
    }
    for (const key of ["allOf", "anyOf", "oneOf"]) if (Array.isArray(node[key])) node[key].forEach((child) => visit(child, depth + 1));
    for (const key of ["then", "else"]) if (node[key]) visit(node[key], depth + 1);
  };
  visit(schema);
  return names;
}

function leafValue(value: unknown, path: readonly string[]): unknown {
  for (const key of path) value = record(value) ? value[key] : undefined;
  return value;
}

function meaningful(value: unknown): boolean {
  if (typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(meaningful);
  return record(value) && Object.entries(value).some(([key, child]) => !contextKeys.has(key) && meaningful(child));
}

function currentValues(attributes: RecordValue | undefined, name: string, marketplaceId: string): RecordValue[] {
  const values = attributes?.[name];
  if (!Array.isArray(values)) return [];
  return values.filter(record).filter((entry) => entry.marketplace_id === marketplaceId || entry.marketplace_id === undefined);
}

export function variationRequiredFieldDescriptors(input: {
  schema: unknown; attributes?: RecordValue; marketplaceId: string;
  dimensionNames: readonly string[]; action: "detach" | "attach";
  targetParentSku?: string | null; variationTheme?: string | null;
  proposedValues?: Readonly<RecordValue>;
  dimensionValues?: Readonly<RecordValue>;
  issueRequiredNames?: readonly string[];
}): VariationFieldDescriptor[] {
  if (!record(input.schema)) return [];
  const scopedAttributes = Object.fromEntries(Object.keys(input.attributes ?? {}).flatMap((name) => {
    const values = currentValues(input.attributes, name, input.marketplaceId);
    return values.length ? [[name, values]] : [];
  }));
  const projected: RecordValue = { ...scopedAttributes };
  for (const name of ["parentage_level", "child_parent_sku_relationship", "variation_theme"]) delete projected[name];
  if (input.action === "attach") {
    projected.parentage_level = [{ value: "child", marketplace_id: input.marketplaceId }];
    projected.child_parent_sku_relationship = [{ parent_sku: input.targetParentSku, child_relationship_type: "variation", marketplace_id: input.marketplaceId }];
    projected.variation_theme = [{ name: input.variationTheme, marketplace_id: input.marketplaceId }];
    for (const name of input.dimensionNames) if (input.dimensionValues?.[name] !== undefined) projected[name] = input.dimensionValues[name];
  }
  // Only answers to already required facts may select a further conditional branch.
  const issueNames = (input.issueRequiredNames ?? []).filter((name) => ptdDeclaredRequiredNames(input.schema).has(name));
  const projectedRequiredNames = () => [...new Set([...requiredNames(input.schema as RecordValue, projected), ...issueNames])];
  const applied = new Set<string>();
  for (let step = 0; step < 30; step += 1) {
    const next = projectedRequiredNames().filter((name) => !applied.has(name) &&
      !protectedNames.has(name) && !input.dimensionNames.includes(name) && input.proposedValues?.[name] !== undefined);
    if (!next.length) break;
    for (const name of next) { projected[name] = input.proposedValues![name]; applied.add(name); }
  }
  const names = projectedRequiredNames().filter((name) =>
    !input.dimensionNames.includes(name) && !["parentage_level", "child_parent_sku_relationship", "variation_theme"].includes(name));
  if (!names.length) return [];
  const fields = variationFieldDescriptors({ includeLanguageSelector: true, productTypeDefinition: input.schema, dimensionNames: names,
    attributes: scopedAttributes, marketplaceId: input.marketplaceId }).filter((field) =>
      !field.values.some(meaningful) || field.values.some((value) => field.leaves.some((leaf) =>
        leaf.required && !meaningful(leafValue(value, leaf.path))))).map((field) => ({
      ...field, label: labels[field.name] ?? field.label,
      editable: field.editable && !field.jsonFallback && field.values.length <= 1 &&
        (input.attributes?.[field.name] === undefined || Array.isArray(input.attributes[field.name]) &&
          (input.attributes[field.name] as unknown[]).every((value) => record(value) && (value.marketplace_id === undefined || typeof value.marketplace_id === "string" && value.marketplace_id.length > 0 && value.marketplace_id === value.marketplace_id.trim()))) && !protectedNames.has(field.name) && !/(?:price|offer|shipping|fulfillment|inventory|availability|image_locator)/u.test(field.name),
    }));
  if (fields.length > 30) fail("缺少的 Amazon 必填產品資料超過 30 欄，請先在商品編輯補齊基本資料。");
  return fields;
}

/** Product facts are fill-only: existing answers and unrelated attributes cannot be overwritten. */
export function validateVariationRequiredValues(input: {
  fields: readonly VariationFieldDescriptor[]; values: Readonly<RecordValue>; marketplaceId: string;
}): RecordValue {
  const allowed = new Map(input.fields.map((field) => [field.name, field]));
  for (const name of Object.keys(input.values)) if (!allowed.has(name)) fail(`「${name}」不是目前缺少的 Amazon 必填欄位；請重新讀取，既有產品資料不會被覆寫。`);
  const result: RecordValue = {};
  const missing: string[] = [];
  for (const field of input.fields) {
    if (!field.editable) fail(`「${field.label}」目前不能安全補填，請在商品編輯頁完成後重新讀取。`);
    const raw = input.values[field.name];
    if (!Array.isArray(raw) || raw.length !== 1 || !record(raw[0])) { missing.push(field.label); continue; }
    const item = structuredClone(raw[0]);
    if (item.marketplace_id !== undefined && item.marketplace_id !== input.marketplaceId) fail(`「${field.label}」站點不一致。`);
    item.marketplace_id = input.marketplaceId;
    if (item.language_tag !== undefined && (typeof item.language_tag !== "string" || !/^[a-z]{2,3}_[A-Z]{2}$/u.test(item.language_tag))) fail(`「${field.label}」語言選擇無效。`);
    const existing = field.values[0];
    if (existing) {
      const preserve = (node: RecordValue, path: string[] = []) => {
        for (const [key, previous] of Object.entries(node)) {
          if (key === "marketplace_id" && path.length === 0) continue;
          const current = [...path, key];
          if (record(previous)) preserve(previous, current);
          else if (meaningful(previous) && JSON.stringify(leafValue(item, current)) !== JSON.stringify(previous)) fail(`「${field.label}」只能補填缺少的資料，既有內容與選擇條件必須保留。`);
        }
      };
      preserve(existing);
    }
    const allowedPaths = field.leaves.map((leaf) => leaf.path.join("."));
    const inspect = (node: RecordValue, path: string[] = []) => {
      for (const [key, value] of Object.entries(node)) {
        if (path.length === 0 && contextKeys.has(key)) continue;
        const current = [...path, key];
        if (["__proto__", "constructor", "prototype"].includes(key) ||
          !allowedPaths.some((allowedPath) => allowedPath === current.join(".") || allowedPath.startsWith(`${current.join(".")}.`))) {
          fail(`「${field.label}」包含 PTD 未開放的子欄位。`);
        }
        if (record(value)) inspect(value, current);
      }
    };
    inspect(item);
    for (const leaf of field.leaves) {
      let value: unknown = item;
      for (const key of leaf.path) value = record(value) ? value[key] : undefined;
      if (value === undefined || value === null || value === "") { if (leaf.required) missing.push(`${field.label} · ${leaf.label}`); continue; }
      if (leaf.type === "json" || (leaf.type === "integer" ? !Number.isInteger(value) : typeof value !== leaf.type) ||
        leaf.enumValues.length > 0 && !leaf.enumValues.includes(value as string | number | boolean)) fail(`「${field.label} · ${leaf.label}」格式或選項不符 Amazon PTD。`);
      if (typeof value === "string" && (value.length > 5_000 || /[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u17b4\u17b5\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/u.test(value))) fail(`「${field.label}」含無法安全顯示的文字。`);
      if (typeof value === "number" && !Number.isFinite(value)) fail(`「${field.label}」必須是有效數字。`);
    }
    if (!meaningful(item)) missing.push(field.label);
    result[field.name] = [item];
  }
  if (missing.length) throw new VariationUpdateValidationError(`請補填 Amazon 必填資料：${[...new Set(missing)].join("、")}。`, "VARIATION_FIELD_REQUIRED");
  return result;
}

export function requiredValuePatches(values: Readonly<RecordValue>, attributes: RecordValue | undefined, marketplaceId: string): VariationPatchOperation[] {
  return Object.entries(values).map(([name, requested]) => {
    const existing = attributes?.[name];
    if (existing !== undefined && (!Array.isArray(existing) || existing.some((value) => !record(value) || (value.marketplace_id !== undefined && (typeof value.marketplace_id !== "string" || !value.marketplace_id || value.marketplace_id !== value.marketplace_id.trim()))))) fail(`「${name}」既有欄位選擇條件不明，無法安全補填。`);
    const otherMarkets = Array.isArray(existing) ? existing.filter((value) => record(value) &&
      typeof value.marketplace_id === "string" && value.marketplace_id !== marketplaceId) : [];
    return { op: Array.isArray(existing) && existing.length ? "replace" : "add", path: `/attributes/${name}`,
      value: [...structuredClone(otherMarkets), ...structuredClone(requested as unknown[])] };
  });
}

/** Main-only digests enable GET recovery without persisting raw product facts. */
export function variationAttributeSignatures(attributes: RecordValue | undefined, marketplaceId: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of Object.keys(attributes ?? {})) {
    if (!/^[a-z][a-z0-9_]{0,79}$/u.test(name)) continue;
    try {
      const canonical = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(canonical).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
        if (record(value)) return Object.fromEntries(Object.keys(value).filter((key) => key !== "marketplace_id").sort().map((key) => [key, canonical(value[key])]));
        return value;
      };
      const values = currentValues(attributes, name, marketplaceId);
      if (!values.length || !values.some(meaningful)) continue;
      result[name] = createHash("sha256").update(JSON.stringify(canonical(values))).digest("hex");
    } catch { /* Missing or malformed facts never establish canonical proof. */ }
  }
  return result;
}
