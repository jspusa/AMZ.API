import { createHash } from "node:crypto";
import { listingItemReadScopeMatches, type ListingItemReadScope } from "./listing-item-read-scope";
import { publicSpApiListingIssues } from "./sp-api-error";
import { managedVariationAttribute, ptdAttributeDefinitions } from "./variation-required-fields";
import { variationFieldDescriptors, VariationUpdateValidationError,
  type VariationFieldDescriptor, type VariationPatchOperation } from "./variation-update";

type Facts = Readonly<Record<string, unknown>>;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) &&
  typeof value === "object" && !Array.isArray(value);
const attributeName = /^[a-z][a-z0-9_]{0,79}$/u;
const safeText = (value: unknown): value is string => typeof value === "string" &&
  value.length > 0 && value.length <= 5_000 && value === value.trim() &&
  publicSpApiListingIssues([{ code: "PRODUCT_FACT", severity: "ERROR", message: value }])[0]?.message === value;

/** Whole attribute proof: includes every selector and preserves array order. Never public. */
export function wholeVariationAttributeSignatures(attributes: Facts | undefined): Record<string, string> {
  const canonical = (value: unknown, depth = 0): unknown => {
    if (depth > 8) throw new Error("Unsupported attribute depth");
    if (Array.isArray(value)) {
      if (value.length > 30) throw new Error("Unsupported attribute rows");
      return value.map((child) => canonical(child, depth + 1));
    }
    if (record(value)) return Object.fromEntries(Object.keys(value).sort().map((key) =>
      [key, canonical(value[key], depth + 1)]));
    if (value === null || typeof value === "string" || typeof value === "boolean" ||
      typeof value === "number" && Number.isFinite(value)) return value;
    throw new Error("Unsupported attribute value");
  };
  const result: Record<string, string> = {};
  for (const name of Object.keys(attributes ?? {}).sort()) {
    const values = attributes![name];
    if (!attributeName.test(name) || !Array.isArray(values) || !values.length) continue;
    try {
      const serialized = JSON.stringify(canonical(values));
      if (serialized.length <= 24_000) result[name] = createHash("sha256").update(serialized).digest("hex");
    } catch { /* Malformed or incomplete values never prove preservation. */ }
  }
  return result;
}

/** Only exact private missing-name evidence can offer a complete existing scalar fact. */
export function preservedRequiredFieldDescriptors(input: Readonly<{
  schema: unknown;
  attributes: Record<string, unknown> | undefined;
  marketplaceId: string;
  sellerSku: string;
  singleMarketplaceScope?: ListingItemReadScope;
  dimensionNames: readonly string[];
  issueRequiredNames: readonly string[];
}>): VariationFieldDescriptor[] {
  if (!listingItemReadScopeMatches({ scope: input.singleMarketplaceScope,
    marketplaceId: input.marketplaceId, sellerSku: input.sellerSku, attributes: input.attributes })) return [];
  const definitions = ptdAttributeDefinitions(input.schema);
  const fields: VariationFieldDescriptor[] = [];
  for (const name of [...new Set(input.issueRequiredNames)].slice(0, 30)) {
    if (!attributeName.test(name) || !definitions.has(name) || managedVariationAttribute(name) || input.dimensionNames.includes(name)) continue;
    const raw = input.attributes?.[name];
    if (!Array.isArray(raw) || raw.length !== 1 || !record(raw[0])) continue;
    const row = raw[0];
    if (Object.keys(row).some((key) => !["value", "marketplace_id", "language_tag"].includes(key)) ||
      Object.hasOwn(row, "marketplace_id") && row.marketplace_id !== input.marketplaceId ||
      Object.hasOwn(row, "language_tag") && (typeof row.language_tag !== "string" || !/^[a-z]{2,3}_[A-Z]{2}$/u.test(row.language_tag))) continue;
    try {
      const field = variationFieldDescriptors({ includeLanguageSelector: true,
        productTypeDefinition: input.schema, dimensionNames: [name], attributes: input.attributes,
        marketplaceId: input.marketplaceId })[0]!;
      const leaves = field.leaves.filter((leaf) => leaf.path.join(".") !== "language_tag");
      if (field.jsonFallback || leaves.length !== 1 || leaves[0]!.path.join(".") !== "value") continue;
      if (field.leaves.some((leaf) => {
        const value = row[leaf.path[0]!];
        if (value === undefined) return leaf.required;
        return leaf.type === "json" || (leaf.type === "integer" ? !Number.isInteger(value) : typeof value !== leaf.type) ||
          typeof value === "number" && !Number.isFinite(value) || typeof value === "string" && !safeText(value) ||
          leaf.enumValues.length > 0 && !leaf.enumValues.includes(value as string | number | boolean);
      }) || row.value === undefined || row.value === null) continue;
      // Editable is informational for this path: only the exact existing row can be resent.
      fields.push({ ...field, editable: false, leaves,
        label: name === "contains_liquid_contents" || name === "contains_liquid" ? "產品是否含液體" : definitions.get(name)?.[0] ?? field.label,
        values: structuredClone(raw) as Array<Record<string, unknown>> });
    } catch (error) {
      if (!(error instanceof VariationUpdateValidationError)) throw error;
    }
  }
  return fields;
}

/** Caller chooses names only. The main-owned observation supplies every value and selector. */
export function selectPreservedRequiredValues(fields: readonly VariationFieldDescriptor[], names: readonly string[] = []): Record<string, unknown> {
  const byName = new Map(fields.map((field) => [field.name, field]));
  if (names.length > 30 || new Set(names).size !== names.length || names.some((name) => !attributeName.test(name) || !byName.has(name))) {
    throw new VariationUpdateValidationError("保留原值的欄位證據已失效或不在本次 Amazon 缺漏清單，請重新檢查。", "VARIATION_REQUIREMENTS_CHANGED");
  }
  return Object.fromEntries([...names].sort().map((name) => [name, structuredClone(byName.get(name)!.values)]));
}

export function preservedRequiredValuePatches(values: Facts): VariationPatchOperation[] {
  return Object.entries(values).map(([name, value]) => ({ op: "replace", path: `/attributes/${name}`,
    value: structuredClone(value) as unknown[] }));
}
