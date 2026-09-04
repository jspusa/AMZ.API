import { readFile } from "node:fs/promises";
import { createElement } from "react";
import {
  act,
  create,
  type ReactTestRenderer,
} from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import SkuOperationsDrawer, {
  createListingContentMutationBody,
  listingContentMatches,
  normalizeListingContentSnapshot,
} from "../src/renderer/src/components/sku-operations-drawer";
import ContentAuditPanel from
  "../src/renderer/src/components/content-audit-panel";

const original = {
  title: "Original product name",
  itemHighlight: "Original item highlight",
  bulletPoints: ["Original bullet"],
  productDescription: "Original product description",
  ingredients: "Turkey tendon",
};

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT;
});

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
      exactBulletReplacementAcknowledgement: "a".repeat(64),
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
      exactBulletReplacementAcknowledgement: "a".repeat(64),
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
    expect(source).toContain("本次會完整取代 Amazon 目前同語系產品要點");
    expect(source).toContain("我已逐項核對上述 Amazon 原值、更新值與刪除範圍");
    expect(source).toContain("exactBulletReplacementAcknowledgement");
  });

  it("keeps the native update action disabled until every overflow bullet disclosure is acknowledged", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    const firstFive = Array.from(
      { length: 5 },
      (_, index) => `Legacy bullet ${index + 1}`,
    );
    const capability = {
      supported: true,
      editable: true,
      required: false,
      minItems: 1,
      maxItems: 5,
      minLength: 1,
      maxLength: 2_000,
      maxUtf8Bytes: 8_000,
      languageTags: ["en_US"],
      reason: null,
    };
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      if ((init?.method ?? "GET") === "GET") {
        return new Response(JSON.stringify({
          mode: "live",
          marketplaceId: "ATVPDKIKX0DER",
          sellerSku: "OVERFLOW-SKU",
          asin: "B000000123",
          productType: "PET_FOOD",
          content: { ...original, bulletPoints: firstFive },
          capabilities: {
            title: capability,
            itemHighlight: capability,
            bulletPoints: capability,
            productDescription: capability,
            ingredients: capability,
          },
          status: ["BUYABLE"],
          updatedAt: null,
          fetchedAt: "2026-09-04T00:00:00.000Z",
          requestId: "REQ-OVERFLOW-READ",
          issues: [],
          notice: null,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      const body = JSON.parse(String(init?.body)) as {
        bulletPoints: string[];
      };
      return new Response(JSON.stringify({
        mode: "live",
        status: "VALID",
        notice: "Amazon Validation Preview 已通過。",
        issues: [],
        requestId: "REQ-OVERFLOW-PREVIEW",
        exactBulletReplacement: {
          languageTag: "en_US",
          currentExactLanguageBulletPoints: [
            ...firstFive,
            "Hidden legacy bullet 6",
          ],
          requestedExactLanguageBulletPoints: body.bulletPoints,
          removedOverflowBulletPoints: ["Hidden legacy bullet 6"],
        },
        exactBulletReplacementAcknowledgement: "a".repeat(64),
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(createElement(SkuOperationsDrawer, {
        initialMarketplaceId: "ATVPDKIKX0DER",
        initialSellerSku: "OVERFLOW-SKU",
        initialTab: "single",
        presentation: "workspace",
        onClose: vi.fn(),
      }));
    });
    const root = renderer!.root;
    await act(async () => Promise.resolve());
    const firstBullet = root.findByProps({ id: "content-bullet-1" });
    await act(async () => firstBullet.props.onChange({
      target: { value: "Updated bullet 1" },
    }));
    const preview = root.findAllByType("button").find((button) =>
      button.children.join("").includes("檢查這次內容變更")
    );
    if (!preview) throw new Error("Missing single-SKU content preview action");
    await act(async () => preview.props.onClick());

    const disclosure = root.findByProps({
      className: "price-warning compact content-exact-bullet-replacement",
    });
    expect(disclosure.findAllByType("strong").some((item) =>
      item.children.join("") === "本次會完整取代 Amazon 目前同語系產品要點"
    )).toBe(true);
    expect(root.findAllByType("li").some((item) =>
      item.children.join("") === "Hidden legacy bullet 6"
    )).toBe(true);
    const confirmation = () => root.findAllByType("button").find((button) =>
      button.children.join("").includes("使用 Notebook 鑰匙確認更新")
    );
    expect(confirmation()?.props.disabled).toBe(true);
    const acknowledgement = root.findAllByType("input").find((input) =>
      input.props.type === "checkbox"
    );
    if (!acknowledgement) throw new Error("Missing overflow acknowledgement");
    await act(async () => acknowledgement.props.onChange({
      target: { checked: true },
    }));
    expect(confirmation()?.props.disabled).toBe(false);

    await act(async () => renderer!.unmount());
  });

  it("locks close, tabs and marketplace switching while an Excel batch is busy", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    const onClose = vi.fn();
    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(createElement(SkuOperationsDrawer, {
        initialMarketplaceId: "ATVPDKIKX0DER",
        initialTab: "audit",
        presentation: "workspace",
        onClose,
      }));
    });
    const root = renderer!.root;
    const panel = root.findByType(ContentAuditPanel);
    expect(typeof panel.props.onBatchBusyChange).toBe("function");

    await act(async () => panel.props.onBatchBusyChange(true));
    expect(root.findByProps({
      "data-audit-workspace": "true",
    }).props["aria-busy"]).toBe(true);
    expect(root.findByProps({ id: "content-marketplace" }).props.disabled)
      .toBe(true);
    expect(root.findAllByProps({ role: "tab" }).every((tab) =>
      tab.props.disabled === true
    )).toBe(true);
    const back = root.findByProps({ className: "audit-workspace-back" });
    expect(back.props.disabled).toBe(true);
    back.props.onClick();
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => panel.props.onBatchBusyChange(false));
    expect(root.findByProps({ id: "content-marketplace" }).props.disabled)
      .toBe(false);
    expect(root.findAllByProps({ role: "tab" }).every((tab) =>
      tab.props.disabled === false
    )).toBe(true);
    root.findByProps({ className: "audit-workspace-back" }).props.onClick();
    expect(onClose).toHaveBeenCalledOnce();
    await act(async () => renderer!.unmount());
  });
});
