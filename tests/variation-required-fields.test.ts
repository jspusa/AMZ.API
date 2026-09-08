import { describe, expect, it } from "vitest";
import { variationRequiredFieldDescriptors, validateVariationRequiredValues, requiredValuePatches, variationAttributeSignatures } from "../src/main/amazon/variation-required-fields";

const market = "ATVPDKIKX0DER";
const jp = "A1VC38T7YXB528";
const booleanAttribute = { type: "array", items: { type: "object", required: ["value"], properties: { value: { type: "boolean" }, marketplace_id: { type: "string" } } } };
const schema = { type: "object", required: ["contains_liquid"], properties: { contains_liquid: booleanAttribute, is_liquid_double_sealed: booleanAttribute },
  allOf: [{ if: { required: ["contains_liquid"], properties: { contains_liquid: { contains: { properties: { value: { const: true } }, required: ["value"] } } } }, then: { required: ["is_liquid_double_sealed"] } }] };
const descriptors = (attributes: Record<string, unknown> = {}, proposedValues: Record<string, unknown> = {}) => variationRequiredFieldDescriptors({ schema, attributes, proposedValues, marketplaceId: market, action: "attach", dimensionNames: [], targetParentSku: "PARENT", variationTheme: "SIZE_NAME" });

describe("PTD required product facts", () => {
  it("keeps boolean facts unanswered and resolves only the user's selected conditional branch", () => {
    expect(descriptors()).toMatchObject([{ name: "contains_liquid", editable: true, leaves: [{ type: "boolean", currentValue: null }] }]);
    expect(descriptors({}, { contains_liquid: [{ value: false }] }).map((field) => field.name)).toEqual(["contains_liquid"]);
    const fields = descriptors({}, { contains_liquid: [{ value: true }] });
    expect(fields.map((field) => field.name)).toEqual(["contains_liquid", "is_liquid_double_sealed"]);
    expect(() => validateVariationRequiredValues({ fields, values: { contains_liquid: [{ value: true }] }, marketplaceId: market })).toThrow("液體是否採雙重密封");
    expect(validateVariationRequiredValues({ fields: descriptors(), values: { contains_liquid: [{ value: false }] }, marketplaceId: market })).toEqual({ contains_liquid: [{ value: false, marketplace_id: market }] });
  });

  it("does not ask for or overwrite a present false answer or unrelated data", () => {
    expect(descriptors({ contains_liquid: [{ value: false, marketplace_id: market }] })).toEqual([]);
    for (const values of [{ contains_liquid: [{ value: "false" }] }, { contains_liquid: [{ value: false }], purchasable_offer: [{ value: 10 }] }, { contains_liquid: [{ value: false, unexpected: true }] }]) {
      expect(() => validateVariationRequiredValues({ fields: descriptors(), values, marketplaceId: market })).toThrow();
    }
    expect(() => validateVariationRequiredValues({ fields: [], values: { contains_liquid: [{ value: true }] }, marketplaceId: market })).toThrow("不是目前缺少");
  });

  it("fills a missing nested fact while preserving existing values and selectors", () => {
    const weightSchema = { required: ["item_weight"], properties: { item_weight: { type: "array", items: { type: "object", required: ["value", "unit"], properties: { value: { type: "number" }, unit: { type: "string", enum: ["ounces", "pounds"] }, marketplace_id: { type: "string" }, language_tag: { type: "string" } } } } } };
    const attributes = { item_weight: [{ unit: "ounces", language_tag: "en_US", marketplace_id: market }, { value: 300, unit: "grams", marketplace_id: jp }] };
    const fields = variationRequiredFieldDescriptors({ schema: weightSchema, attributes, marketplaceId: market, action: "detach", dimensionNames: [] });
    expect(fields).toMatchObject([{ name: "item_weight", editable: true, values: [{ unit: "ounces" }] }]);
    const values = validateVariationRequiredValues({ fields, values: { item_weight: [{ value: 4, unit: "ounces", language_tag: "en_US" }] }, marketplaceId: market });
    expect(requiredValuePatches(values, attributes, market)).toEqual([{ op: "replace", path: "/attributes/item_weight", value: [{ value: 300, unit: "grams", marketplace_id: jp }, { value: 4, unit: "ounces", language_tag: "en_US", marketplace_id: market }] }]);
    expect(() => validateVariationRequiredValues({ fields, values: { item_weight: [{ value: 4, unit: "pounds", language_tag: "en_US" }] }, marketplaceId: market })).toThrow("既有內容");
  });

  it("supports local refs and blocks unsupported or readonly shapes explicitly", () => {
    const refSchema = { $ref: "#/$defs/product", $defs: { product: schema } };
    expect(variationRequiredFieldDescriptors({ schema: refSchema, marketplaceId: market, action: "detach", dimensionNames: [] })).toMatchObject([{ name: "contains_liquid" }]);
    const readonly = { required: ["contains_liquid"], properties: { contains_liquid: { ...booleanAttribute, items: { ...booleanAttribute.items, properties: { value: { type: "boolean", readOnly: true } } } } } };
    expect(variationRequiredFieldDescriptors({ schema: readonly, marketplaceId: market, action: "detach", dimensionNames: [] })).toMatchObject([{ editable: false }]);
    const nestedArray = { required: ["item_weight"], properties: { item_weight: { type: "array", items: { type: "array", items: { type: "number" } } } } };
    expect(variationRequiredFieldDescriptors({ schema: nestedArray, marketplaceId: market, action: "detach", dimensionNames: [] })).toMatchObject([{ editable: false, jsonFallback: true }]);
  });

  it("accepts only PTD-declared required issue attributes and never arbitrary optional fields", () => {
    const issueSchema = { properties: { contains_liquid: booleanAttribute, batteries_required: booleanAttribute }, allOf: [{ if: { serverOnlyPredicate: true }, then: { required: ["contains_liquid"] } }] };
    const fields = variationRequiredFieldDescriptors({ schema: issueSchema, marketplaceId: market, action: "detach", dimensionNames: [], issueRequiredNames: ["contains_liquid", "batteries_required", "unknown"] });
    expect(fields.map((field) => field.name)).toEqual(["contains_liquid"]);
  });

  it("never selects a conditional fact from another marketplace or malformed scope", () => {
    expect(descriptors({ contains_liquid: [{ value: true, marketplace_id: jp }] }).map((field) => field.name)).toEqual(["contains_liquid"]);
    expect(descriptors({ contains_liquid: [{ value: false, marketplace_id: "" }] })).toMatchObject([{ name: "contains_liquid", editable: false }]);
  });

  it("produces current-market digests without retaining product facts", () => {
    const facts = { contains_liquid: [{ value: false, marketplace_id: market }, { value: true, marketplace_id: jp }] };
    const signatures = variationAttributeSignatures(facts, market);
    expect(signatures.contains_liquid).toMatch(/^[a-f0-9]{64}$/u);
    expect(signatures).toEqual(variationAttributeSignatures({ contains_liquid: [{ value: false, marketplace_id: market }] }, market));
    expect(signatures).not.toEqual(variationAttributeSignatures({ contains_liquid: [{ value: true, marketplace_id: market }] }, market));
  });
});
