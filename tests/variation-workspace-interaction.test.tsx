import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import VariationPlannerDrawer from "../src/renderer/src/components/variation-planner-drawer";
import type {
  VariationFamilyView,
  VariationMemberView,
} from "../src/renderer/src/variation-planner";

const marketplaceId = "ATVPDKIKX0DER";
const member = (
  sellerSku: string,
  parentSku: string | null,
): VariationMemberView => ({
  sellerSku,
  parentSku,
  asin: "B000000001",
  title: `商品 ${sellerSku}`,
  productType: "PET_FOOD",
  status: ["BUYABLE"],
  role: parentSku ? "child" : "parent",
  fba: Boolean(parentSku),
  childSkus: [],
  variationTheme: "SIZE_NAME",
  dimensions: [{ name: "size_name", label: "Size", values: ["4 oz"] }],
  issues: [],
  relationshipSources: ["relationships"],
});
const family = (target: boolean): VariationFamilyView => {
  const parent = member(target ? "TARGET" : "SOURCE", null);
  const child = member(target ? "REFERENCE" : "CHILD", parent.sellerSku);
  return {
    mode: "live",
    marketplaceId,
    queriedSku: target ? parent.sellerSku : child.sellerSku,
    queriedRole: target ? "parent" : "child",
    queried: target ? parent : child,
    parent,
    children: [child],
    excludedChildren: [],
    variationTheme: "SIZE_NAME",
    dimensionNames: ["size_name"],
    familyComplete: true,
    fetchedAt: "2026-09-08T10:00:00Z",
    requestIds: [],
    writable: false,
    boundaries: [],
    notice: "唯讀",
  };
};
const field = (name: string, label: string, type: "boolean" | "string") => ({
  name,
  label,
  editable: true,
  values: [],
  leaves: [
    {
      path: ["value"],
      label: "Value",
      type,
      required: true,
      enumValues: [],
      currentValue: null,
    },
  ],
  jsonFallback: false,
});
const prepared = (action: "detach" | "attach") => ({
  mode: "live",
  action,
  marketplaceId,
  sellerSku: "CHILD",
  sourceParentSku: "SOURCE",
  targetParentSku: action === "attach" ? "TARGET" : null,
  productType: "PET_FOOD",
  variationTheme: action === "attach" ? "SIZE_NAME" : null,
  dimensionNames: action === "attach" ? ["size_name"] : [],
  fields: action === "attach" ? [field("size_name", "Size", "string")] : [],
  requiredFields: [
    field("contains_liquid_contents", "Contains Liquid Contents", "boolean"),
  ],
  writable: true,
  preparedAt: "2026-09-08T10:00:00Z",
  requestIds: [],
  blockers: [],
  warnings: [],
  notice: "必填資料",
});
let renderer: ReactTestRenderer | null = null;
const output = () => JSON.stringify(renderer?.toJSON());
async function click(name: string) {
  await act(async () => {
    renderer!.root.findByProps({ "aria-label": name }).props.onClick();
  });
}
async function change(name: string, value: string) {
  await act(async () => {
    renderer!.root
      .findByProps({ "aria-label": name })
      .props.onChange({ target: { value } });
  });
}
async function mount(options: {
  source?: VariationFamilyView;
  target?: VariationFamilyView;
  preparation?: unknown;
  onRequiredFieldsFocus?: () => void;
} = {}) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        return Response.json({
          ...body,
          mode: "live",
          status: "VALID",
          sourceParentSku: body.expectedSourceParentSku,
          validatedAt: "2026-09-08T10:00:00Z",
          issues: [],
          notice: "檢查通過",
          changes: [
            {
              name: "contains_liquid_contents",
              label: "是否含液體",
              before: null,
              after: [{ value: false }],
            },
          ],
        });
      }
      if (input.includes("variation-family?"))
        return Response.json(input.includes("sku=TARGET")
          ? options.target ?? family(true)
          : options.source ?? family(false));
      return Response.json(
        options.preparation ?? prepared(input.includes("action=detach") ? "detach" : "attach"),
      );
    }),
  );
  await act(async () => {
    renderer = create(
      <VariationPlannerDrawer
        initialMarketplaceId={marketplaceId}
        initialSellerSku="CHILD"
        presentation="workspace"
        onClose={vi.fn()}
      />,
      {
        createNodeMock: (element) => element.props.id === "variation-required-fields-title"
          ? { focus: options.onRequiredFieldsFocus ?? vi.fn() }
          : null,
      },
    );
  });
  await change("目標 Parent SKU", "TARGET");
  await act(async () => {
    renderer!.root
      .findByProps({ "data-variation-lookup": "target" })
      .props.onClick();
  });
  await click("選擇 CHILD");
}
async function mountStandalone(
  onRequiredFieldsFocus?: () => void,
  requiredFieldChoices?: ReturnType<typeof field>[],
) {
  const source = family(false);
  source.queried = { ...source.queried, role: "standalone", parentSku: null };
  source.queriedRole = "standalone";
  source.parent = null;
  source.children = [];
  source.variationTheme = "ITEM_SHAPE/SIZE";
  source.dimensionNames = ["item_shape", "size"];
  source.queried.variationTheme = "ITEM_SHAPE/SIZE";
  source.queried.dimensions = [
    { name: "item_shape", label: "Shape", values: ["Pretzel"] },
    { name: "size", label: "Size", values: ["4 Count"] },
  ];
  const target = family(true);
  target.variationTheme = "ITEM_SHAPE/SIZE";
  target.dimensionNames = ["item_shape", "size"];
  target.queried.variationTheme = "ITEM_SHAPE/SIZE";
  target.children[0].variationTheme = "ITEM_SHAPE/SIZE";
  target.children[0].dimensions = [
    { name: "item_shape", label: "Shape", values: ["Pretzel"] },
    { name: "size", label: "Size", values: ["8 Count"] },
  ];
  await mount({
    source,
    target,
    onRequiredFieldsFocus,
    preparation: {
      ...prepared("attach"),
      sourceParentSku: null,
      variationTheme: "ITEM_SHAPE/SIZE",
      dimensionNames: ["item_shape", "size"],
      fields: [
        {
          ...field("item_shape", "Shape", "string"),
          editable: false,
          values: [{ marketplace_id: marketplaceId, language_tag: "en_US", value: "Pretzel" }],
        },
        {
          ...field("size", "Size", "string"),
          editable: false,
          values: [{ marketplace_id: marketplaceId, language_tag: "en_US", value: "4 Count" }],
        },
      ],
      requiredFields: [],
      requiredFieldChoices,
    },
  });
}
afterEach(async () => {
  if (renderer) await act(async () => renderer?.unmount());
  renderer = null;
  vi.unstubAllGlobals();
});

describe("variation workspace interactions", () => {
  it("places a clear home action before the workspace title", async () => {
    await mount();
    const header = renderer!.root.findByProps({
      className: "drawer-header variation-workspace-header",
    });
    const back = header.findByProps({ className: "variation-workspace-back" });

    expect(back.children.join("")).toBe("← 回首頁");
    expect(header.children[0]).toBe(back);

    await act(async () => renderer!.update(
      <VariationPlannerDrawer
        presentation="workspace"
        workspaceBackLabel="回到未綁變體健檢"
        initialMarketplaceId={marketplaceId}
        onClose={vi.fn()}
      />,
    ));
    const contextualBack = renderer!.root.findByProps({
      className: "variation-workspace-back",
    });
    expect(contextualBack.children.join("")).toBe("← 回到未綁變體健檢");
    expect(contextualBack.props["aria-label"]).toBe("回到未綁變體健檢");
  });

  it("shows family reference tables and editable required facts before any detach, without guessing a liquid answer", async () => {
    await mount();
    expect(renderer!.root.findAllByProps({ role: "dialog" })).toHaveLength(0);
    expect(renderer!.root.findAllByType("table").length).toBeGreaterThanOrEqual(
      2,
    );
    expect(output()).toContain("REFERENCE");
    expect(output()).toContain("是否含液體");
    const liquid = renderer!.root.findByProps({
      "aria-label": "是否含液體 · Value",
    });
    expect(liquid.props.value).toBe("");
    expect(
      renderer!.root.findByProps({ "aria-label": "檢查解除內容" }).props
        .disabled,
    ).toBe(true);
    expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method)).toBe(
      true,
    );
    await change("是否含液體 · Value", "false");
    expect(
      renderer!.root.findByProps({ "aria-label": "檢查解除內容" }).props
        .disabled,
    ).toBe(false);
    await click("檢查解除內容");
    const body = JSON.parse(
      String(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.body),
    );
    expect(body.requiredValues.contains_liquid_contents).toEqual([
      { marketplace_id: marketplaceId, value: false },
    ]);
    expect(body.dimensionValues).toEqual({});
    expect(output()).toContain("修改前");
    expect(output()).toContain("修改後");
    expect(
      vi
        .mocked(fetch)
        .mock.calls.filter(([, init]) => init?.method === "PATCH"),
    ).toHaveLength(0);
    expect(
      renderer!.root.findByProps({ "aria-label": "確認解除變體" }).props
        .disabled,
    ).toBe(false);
    await change("是否含液體 · Value", "true");
    expect(
      renderer!.root.findAllByProps({ "aria-label": "確認解除變體" }),
    ).toHaveLength(0);
  });
  it("keeps missing booleans blank when cleared and never silently writes false", async () => {
    await mount();
    await change("是否含液體 · Value", "false");
    await change("是否含液體 · Value", "");
    expect(
      renderer!.root.findByProps({ "aria-label": "是否含液體 · Value" }).props
        .value,
    ).toBe("");
    expect(
      renderer!.root.findByProps({ "aria-label": "檢查解除內容" }).props
        .disabled,
    ).toBe(true);
  });
  it("adds conditional Amazon requirements after a rejected preview and keeps the entered product facts", async () => {
    await mount();
    await change("是否含液體 · Value", "true");
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json(
        {
          code: "VARIATION_FIELD_REQUIRED",
          action: "detach",
          marketplaceId,
          sellerSku: "CHILD",
          targetParentSku: null,
          message: "補齊封口資料",
          requiredFields: [field("seal_type", "Seal Type", "string")],
        },
        { status: 422 },
      ),
    );
    await click("檢查解除內容");
    expect(output()).toContain("Amazon 需要補充資料");
    expect(
      renderer!.root.findByProps({ "aria-label": "是否含液體 · Value" }).props
        .value,
    ).toBe("true");
    expect(
      renderer!.root.findByProps({ "aria-label": "檢查解除內容" }).props
        .disabled,
    ).toBe(true);
    await change("Seal Type · Value", "Sealed");
    expect(
      renderer!.root.findByProps({ "aria-label": "檢查解除內容" }).props
        .disabled,
    ).toBe(false);
    expect(
      vi
        .mocked(fetch)
        .mock.calls.filter(([, init]) => init?.method === "PATCH"),
    ).toHaveLength(0);
  });
  it("replaces the ready message after Amazon rejects an otherwise filled attach preview", async () => {
    await mountStandalone();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({
      code: "VARIATION_PREVIEW_INVALID",
      message: "'Contains Liquid Contents?' is required but missing.",
    }, { status: 422 }));

    await click("檢查綁定內容");

    expect(output()).toContain("預檢未通過");
    expect(output()).not.toContain("資料已齊");
    expect(output()).toContain("'Contains Liquid Contents?' is required but missing.");
    expect(renderer!.root.findAllByProps({ "aria-label": "確認綁定變體" })).toHaveLength(0);
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(0);
  });
  it("focuses a newly required liquid field, preserves immutable dimensions, and requires explicit input plus a fresh attach preview", async () => {
    const focus = vi.fn();
    await mountStandalone(focus);
    expect(renderer!.root.findAllByProps({ "aria-label": "是否含液體 · Value" })).toHaveLength(0);
    expect(renderer!.root.findByProps({ "aria-label": "檢查綁定內容" }).props.disabled).toBe(false);
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({
      code: "VARIATION_FIELD_REQUIRED",
      action: "attach",
      marketplaceId,
      sellerSku: "CHILD",
      targetParentSku: "TARGET",
      message: "'Contains Liquid Contents?' is required but missing.",
      requiredFields: [field("contains_liquid_contents", "Contains Liquid Contents?", "boolean")],
    }, { status: 422 }));

    await click("檢查綁定內容");

    expect(focus).toHaveBeenCalledOnce();
    expect(renderer!.root.findByProps({ id: "variation-required-fields-title" }).props.tabIndex).toBe(-1);
    expect(renderer!.root.findByProps({ "aria-label": "是否含液體 · Value" }).props.value).toBe("");
    expect(renderer!.root.findByProps({ "aria-label": "檢查綁定內容" }).props.disabled).toBe(true);
    expect(output()).toContain("待填：");
    expect(output()).not.toContain("資料已齊");
    expect(renderer!.root.findByProps({ "aria-label": "Shape · Amazon 現有值" }).children).toEqual(["Pretzel"]);
    expect(renderer!.root.findByProps({ "aria-label": "Size · Amazon 現有值" }).children).toEqual(["4 Count"]);
    expect(renderer!.root.findAllByProps({ "aria-label": "確認綁定變體" })).toHaveLength(0);

    await change("是否含液體 · Value", "false");
    expect(renderer!.root.findByProps({ "aria-label": "檢查綁定內容" }).props.disabled).toBe(false);
    await click("檢查綁定內容");
    const previews = vi.mocked(fetch).mock.calls
      .filter(([, init]) => init?.method === "POST")
      .map(([, init]) => JSON.parse(String(init?.body)));
    expect(previews).toHaveLength(2);
    expect(previews[0].requiredValues).toEqual({});
    expect(previews[1].idempotencyKey).not.toBe(previews[0].idempotencyKey);
    expect(previews[1].requiredValues).toEqual({
      contains_liquid_contents: [{ marketplace_id: marketplaceId, value: false }],
    });
    expect(previews[1].dimensionValues).toEqual({
      item_shape: [{ marketplace_id: marketplaceId, language_tag: "en_US", value: "Pretzel" }],
      size: [{ marketplace_id: marketplaceId, language_tag: "en_US", value: "4 Count" }],
    });
    expect(renderer!.root.findByProps({ "aria-label": "確認綁定變體" }).props.disabled).toBe(false);
    expect(output()).not.toContain("預檢未通過");
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(0);
    await change("是否含液體 · Value", "true");
    expect(renderer!.root.findAllByProps({ "aria-label": "確認綁定變體" })).toHaveLength(0);
  });
  it("lets the operator select and remove only a supported supplemental field when Amazon cannot identify the missing attribute", async () => {
    await mountStandalone();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({
      code: "VARIATION_FIELD_REQUIRED",
      action: "attach",
      marketplaceId,
      sellerSku: "CHILD",
      targetParentSku: "TARGET",
      message: "無法確認要補的欄位，請選擇正確的商品資料。",
      requiredFields: [],
      requiredFieldChoices: [
        field("product_liquid_flag", "Liquid Information", "boolean"),
        field("package_liquid_flag", "Liquid Information", "boolean"),
      ],
    }, { status: 422 }));

    await click("檢查綁定內容");

    expect(output()).toContain("無法確認要補的欄位");
    expect(output()).toContain("預檢未通過");
    expect(output()).not.toContain("資料已齊");
    const chooser = renderer!.root.findByProps({ "aria-label": "綁定要補充的商品欄位" });
    expect(renderer!.root.findByProps({ "aria-label": "檢查綁定內容" }).props.disabled).toBe(true);
    expect(chooser.props.value).toBe("");
    expect(chooser.findAllByType("option").map((option) => option.children.join(""))).toEqual([
      "請選擇要補充的欄位",
      "Liquid Information（product_liquid_flag）",
      "Liquid Information（package_liquid_flag）",
    ]);
    expect(renderer!.root.findAllByProps({ "aria-label": "Liquid Information · Value" })).toHaveLength(0);

    await change("綁定要補充的商品欄位", "product_liquid_flag");
    expect(renderer!.root.findByProps({ "aria-label": "Liquid Information · Value" }).props.value).toBe("");
    expect(renderer!.root.findByProps({ "aria-label": "檢查綁定內容" }).props.disabled).toBe(true);
    await click("移除自選欄位 product_liquid_flag");
    expect(renderer!.root.findAllByProps({ "aria-label": "Liquid Information · Value" })).toHaveLength(0);
    await change("綁定要補充的商品欄位", "package_liquid_flag");
    await change("Liquid Information · Value", "false");
    await click("檢查綁定內容");

    const previews = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST");
    expect(previews).toHaveLength(2);
    expect(JSON.parse(String(previews[1][1]?.body)).requiredValues).toEqual({
      package_liquid_flag: [{ marketplace_id: marketplaceId, value: false }],
    });
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(0);
    expect(renderer!.root.findByProps({ "aria-label": "確認綁定變體" }).props.disabled).toBe(false);
    await click("移除自選欄位 package_liquid_flag");
    expect(renderer!.root.findAllByProps({ "aria-label": "確認綁定變體" })).toHaveLength(0);
  });
  it.each([
    ["different stage", { action: "detach" }],
    ["different marketplace", { marketplaceId: "A2EUQ1WTGCTBG2" }],
    ["different source", { sellerSku: "OTHER" }],
    ["different target", { targetParentSku: "OTHER" }],
    ["missing binding", { targetParentSku: undefined }],
    ["wrong error code", { code: "PREVIEW_CHANGED" }],
    ["malformed choices", { requiredFieldChoices: [{ name: "product_liquid_flag" }] }],
  ])("does not add supplemental inputs from %s metadata", async (_name, override) => {
    await mountStandalone();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({
      code: "VARIATION_FIELD_REQUIRED",
      action: "attach",
      marketplaceId,
      sellerSku: "CHILD",
      targetParentSku: "TARGET",
      message: "無法確認要補的欄位。",
      requiredFields: [],
      requiredFieldChoices: [field("product_liquid_flag", "Liquid Information", "boolean")],
      ...override,
    }, { status: 422 }));
    await click("檢查綁定內容");
    expect(renderer!.root.findAllByProps({ "aria-label": "綁定要補充的商品欄位" })).toHaveLength(0);
    expect(renderer!.root.findAllByProps({ "aria-label": "Liquid Information · Value" })).toHaveLength(0);
    expect(renderer!.root.findAllByProps({ "aria-label": "確認綁定變體" })).toHaveLength(0);
    expect(output()).toContain("預檢未通過");
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(0);
  });
  it("clears chosen supplemental fields when a fresh target preparation replaces the context", async () => {
    await mountStandalone();
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({
      code: "VARIATION_FIELD_REQUIRED",
      action: "attach",
      marketplaceId,
      sellerSku: "CHILD",
      targetParentSku: "TARGET",
      message: "請選擇要補充的欄位。",
      requiredFields: [],
      requiredFieldChoices: [field("product_liquid_flag", "Liquid Information", "boolean")],
    }, { status: 422 }));
    await click("檢查綁定內容");
    await change("綁定要補充的商品欄位", "product_liquid_flag");
    await change("Liquid Information · Value", "false");
    await change("目標 Parent SKU", "TARGET");
    await act(async () => renderer!.root.findByProps({ "data-variation-lookup": "target" }).props.onClick());
    expect(renderer!.root.findAllByProps({ "aria-label": "綁定要補充的商品欄位" })).toHaveLength(0);
    expect(renderer!.root.findAllByProps({ "aria-label": "Liquid Information · Value" })).toHaveLength(0);
    await click("檢查綁定內容");
    const previews = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST");
    expect(previews).toHaveLength(2);
    expect(JSON.parse(String(previews[1][1]?.body)).requiredValues).toEqual({});
  });
  it("restores main-provided field choices from a fresh GET without selecting or answering them", async () => {
    await mountStandalone(undefined, [field("product_liquid_flag", "Liquid Information", "boolean")]);
    expect(renderer!.root.findByProps({ "aria-label": "綁定要補充的商品欄位" }).props.value).toBe("");
    expect(renderer!.root.findAllByProps({ "aria-label": "Liquid Information · Value" })).toHaveLength(0);
    expect(renderer!.root.findByProps({ "aria-label": "檢查綁定內容" }).props.disabled).toBe(true);
    expect(output()).toContain("選擇要補充的商品欄位");
    expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method)).toBe(true);
  });
  it("lets the operator make a fresh preview after cancelling native approval without claiming an uncertain write", async () => {
    await mount();
    await change("是否含液體 · Value", "false");
    await click("檢查解除內容");
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json(
        { code: "ACTION_CANCELLED", message: "已取消確認" },
        { status: 403 },
      ),
    );
    await click("確認解除變體");
    expect(output()).toContain("尚未送出修改");
    expect(output()).not.toContain("結果待確認 · 已停止後續寫入");
    expect(
      renderer!.root.findByProps({ "aria-label": "檢查解除內容" }).props
        .disabled,
    ).toBe(false);
  });
  it("locks a possibly sent write and never makes another PATCH from a repeated click", async () => {
    await mount();
    await change("是否含液體 · Value", "false");
    await click("檢查解除內容");
    const confirm = renderer!.root.findByProps({ "aria-label": "確認解除變體" })
      .props.onClick;
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ message: "結果不明，禁止重送" }, { status: 409 }),
    );
    await act(async () => {
      await confirm();
    });
    expect(output()).toContain("結果待確認");
    expect(
      renderer!.root.findByProps({ "aria-label": "檢查解除內容" }).props
        .disabled,
    ).toBe(true);
    await act(async () => {
      await confirm();
    });
    expect(
      vi
        .mocked(fetch)
        .mock.calls.filter(([, init]) => init?.method === "PATCH"),
    ).toHaveLength(1);
  });
  it("retains drafted target dimensions across verified detach and uses a separate preview and single commit for attach", async () => {
    await mount();
    const fixtureRequest = vi.mocked(fetch).getMockImplementation()!;
    let detached = false;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        if (body.action === "detach") detached = true;
        return Response.json({
          ...body,
          mode: "live",
          status: "ACCEPTED",
          verified: true,
          sourceParentSku: body.expectedSourceParentSku,
          completedAt: "2026-09-08T10:00:00Z",
          submissionId: null,
          requestId: null,
          issues: [],
          notice: "已回查",
        });
      }
      if (detached && String(input).includes("variation-move?"))
        return Response.json({
          ...prepared("attach"),
          sourceParentSku: null,
          requiredFields: [],
        });
      return fixtureRequest(input, init);
    });
    await change("是否含液體 · Value", "false");
    await change("Size · Value", "8 oz");
    expect(
      renderer!.root.findByProps({ "aria-label": "檢查綁定內容" }).props
        .disabled,
    ).toBe(true);
    await click("檢查解除內容");
    await click("確認解除變體");
    expect(output()).toContain("解除已完成唯讀回查");
    expect(
      renderer!.root.findByProps({ "aria-label": "Size · Value" }).props.value,
    ).toBe("8 oz");
    expect(
      renderer!.root.findByProps({ "aria-label": "檢查綁定內容" }).props
        .disabled,
    ).toBe(false);
    await click("檢查綁定內容");
    await click("確認綁定變體");
    const writes = vi
      .mocked(fetch)
      .mock.calls.filter(([, init]) => init?.method === "PATCH")
      .map(([, init]) => JSON.parse(String(init?.body)));
    expect(writes.map((body) => body.action)).toEqual(["detach", "attach"]);
    expect(writes[0].idempotencyKey).not.toBe(writes[1].idempotencyKey);
    expect(writes[1].dimensionValues.size_name).toEqual([
      { marketplace_id: marketplaceId, value: "8 oz" },
    ]);
    expect(writes[1].requiredValues).toEqual({});
    expect(output()).toContain("綁定已完成唯讀回查");
  });
});
