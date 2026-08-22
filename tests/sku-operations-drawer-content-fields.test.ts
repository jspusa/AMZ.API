import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  createListingContentMutationBody,
  listingContentMatches,
  normalizeListingContentSnapshot,
} from "../src/renderer/src/components/sku-operations-drawer";

const original = {
  title: "Original product name",
  itemHighlight: "Original item highlight",
  bulletPoints: ["Original bullet"],
  productDescription: "Original product description",
  ingredients: "Turkey tendon",
};

describe("single-SKU listing content fields", () => {
  it("normalizes Amazon attribute aliases and their current field capabilities", () => {
    const snapshot = normalizeListingContentSnapshot({
      mode: "live",
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "AFA12AM",
      title: original.title,
      title_differentiation: original.itemHighlight,
      bulletPoints: original.bulletPoints,
      product_description: original.productDescription,
      ingredients: original.ingredients,
      capabilities: {
        title_differentiation: {
          supported: true,
          editable: true,
          required: false,
          minItems: 1,
          maxItems: 1,
          minLength: 1,
          maxLength: 125,
          maxUtf8Bytes: 500,
          languageTags: ["en_US"],
        },
        product_description: {
          supported: true,
          editable: true,
          required: false,
          minItems: 1,
          maxItems: 1,
          minLength: 1,
          maxLength: 10_000,
          maxUtf8Bytes: 20_000,
          languageTags: ["en_US"],
        },
      },
    });

    expect(snapshot.content).toEqual(original);
    expect(snapshot.capabilities.itemHighlight).toMatchObject({
      supported: true,
      editable: true,
      maxLength: 125,
      maxUtf8Bytes: 500,
      languageTags: ["en_US"],
    });
    expect(snapshot.capabilities.productDescription).toMatchObject({
      supported: true,
      editable: true,
      maxLength: 10_000,
      maxUtf8Bytes: 20_000,
      languageTags: ["en_US"],
    });
  });

  it("fails closed for new fields when an older bridge omits their capabilities", () => {
    const snapshot = normalizeListingContentSnapshot({
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "OLD-BRIDGE",
      title: original.title,
      bulletPoints: original.bulletPoints,
      ingredients: original.ingredients,
    });

    expect(snapshot.capabilities.itemHighlight).toMatchObject({
      supported: false,
      editable: false,
      reason: expect.stringContaining("請先更新 App"),
    });
    expect(snapshot.capabilities.productDescription).toMatchObject({
      supported: false,
      editable: false,
      reason: expect.stringContaining("請先更新 App"),
    });
  });

  it("carries original and requested values for all five content fields", () => {
    const requested = {
      ...original,
      itemHighlight: "Updated item highlight",
      productDescription: "Updated product description",
    };
    const payload = createListingContentMutationBody({
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "AFA12AM",
      expected: original,
      requested,
      idempotencyKey: "content-test-key",
    });

    expect(payload).toMatchObject({
      expectedTitle: original.title,
      expectedItemHighlight: original.itemHighlight,
      expectedBulletPoints: original.bulletPoints,
      expectedProductDescription: original.productDescription,
      expectedIngredients: original.ingredients,
      title: requested.title,
      itemHighlight: requested.itemHighlight,
      bulletPoints: requested.bulletPoints,
      productDescription: requested.productDescription,
      ingredients: requested.ingredients,
      confirmationSku: "AFA12AM",
      idempotencyKey: "content-test-key",
    });
  });

  it("includes the new fields in stale-value and readback equality checks", () => {
    expect(listingContentMatches(original, { ...original })).toBe(true);
    expect(listingContentMatches(original, {
      ...original,
      itemHighlight: "Changed highlight",
    })).toBe(false);
    expect(listingContentMatches(original, {
      ...original,
      productDescription: "Changed description",
    })).toBe(false);
  });

  it("renders editable fields and Unicode-aware character counts", async () => {
    const source = await readFile(
      new URL(
        "../src/renderer/src/components/sku-operations-drawer.tsx",
        import.meta.url,
      ),
      "utf8",
    );

    expect(source).toContain('id="content-item-highlight"');
    expect(source).toContain('id="content-product-description"');
    expect(source).toContain("contentCharacterLength(draft.itemHighlight)");
    expect(source).toContain("contentCharacterLength(draft.productDescription)");
    expect(source).toContain(
      "產品名稱、產品亮點、五大賣點、產品敘述與成分已完成回讀核對。",
    );
  });
});
