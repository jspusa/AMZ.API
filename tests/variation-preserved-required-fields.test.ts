import { describe, expect, it } from "vitest";
import { captureListingItemReadScope } from "../src/main/amazon/listing-item-read-scope";
import { preservedRequiredFieldDescriptors, wholeVariationAttributeSignatures } from "../src/main/amazon/variation-preserved-required-fields";

const marketplaceId = "ATVPDKIKX0DER";
const sellerSku = "SYNTHETIC-PRESERVED-FACT";
const schema = { properties: { contains_liquid_contents: { type: "array", editable: false,
  items: { type: "object", required: ["value"], properties: { value: { type: "boolean" } } } } } };
const attributes = { contains_liquid_contents: [{ value: false }] };
const scope = () => captureListingItemReadScope({ marketplaceIds: [marketplaceId], marketplaceId, sellerSku,
  envelope: { sku: sellerSku, attributes } });
const input = () => ({ marketplaceId, sellerSku, schema, attributes, dimensionNames: [],
  issueRequiredNames: ["contains_liquid_contents"], singleMarketplaceScope: scope() });

describe("main-owned exact existing required facts", () => {
  it("uses the actual singleton read capability when the original marketplace selector is absent", () => {
    expect(preservedRequiredFieldDescriptors(input())).toMatchObject([{ name: "contains_liquid_contents", values: [{ value: false }], editable: false }]);
    expect(preservedRequiredFieldDescriptors({ ...input(), singleMarketplaceScope: undefined })).toEqual([]);
    expect(preservedRequiredFieldDescriptors({ ...input(), attributes: structuredClone(attributes) })).toEqual([]);
    expect(preservedRequiredFieldDescriptors({ ...input(), sellerSku: "OTHER-SKU" })).toEqual([]);
  });

  it("requires exact private missing-name evidence independent of PTD required or read-only status", () => {
    expect(preservedRequiredFieldDescriptors({ ...input(), issueRequiredNames: [] })).toEqual([]);
    expect(preservedRequiredFieldDescriptors({ ...input(), issueRequiredNames: ["other_fact"] })).toEqual([]);
    expect(preservedRequiredFieldDescriptors({ ...input(), dimensionNames: ["contains_liquid_contents"] })).toEqual([]);
    expect(preservedRequiredFieldDescriptors({ ...input(), schema: { properties: {} } })).toEqual([]);
  });

  it("rejects incomplete required language selectors and exact enum or type mismatches", () => {
    for (const valueSchema of [{ type: "boolean", enum: [true] }, { type: "string" }]) {
      expect(preservedRequiredFieldDescriptors({ ...input(), schema: { properties: { contains_liquid_contents: {
        type: "array", items: { type: "object", required: ["value"], properties: { value: valueSchema } },
      } } } })).toEqual([]);
    }
    expect(preservedRequiredFieldDescriptors({ ...input(), schema: { properties: { contains_liquid_contents: {
      type: "array", items: { type: "object", required: ["value", "language_tag"],
        properties: { value: { type: "boolean" }, language_tag: { type: "string" } } },
    } } } })).toEqual([]);
  });

  it("retains entire-array order and all selectors while ignoring only JSON object key order", () => {
    const original = { product_fact: [{ value: false }, { value: true, marketplace_id: marketplaceId }] };
    const digest = wholeVariationAttributeSignatures(original);
    expect(digest).toEqual(wholeVariationAttributeSignatures({ product_fact: [{ value: false }, { marketplace_id: marketplaceId, value: true }] }));
    expect(digest).not.toEqual(wholeVariationAttributeSignatures({ product_fact: [...original.product_fact].reverse() }));
    expect(digest).not.toEqual(wholeVariationAttributeSignatures({ product_fact: [{ value: false, marketplace_id: marketplaceId }, original.product_fact[1]] }));
    expect(digest).not.toEqual(wholeVariationAttributeSignatures({ product_fact: [original.product_fact[0]] }));
    expect(JSON.stringify(digest)).not.toContain("false");
  });
});
