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
const preservedLiquid = (value = false) => ({
  ...field("contains_liquid_contents", "Contains Liquid Contents?", "boolean"),
  editable: false,
  values: [{ marketplace_id: marketplaceId, value }],
  leaves: [{
    path: ["value"], label: "Value", type: "boolean", required: true,
    enumValues: [], currentValue: value,
  }],
});
const preservedFieldError = (override: Record<string, unknown> = {}) => Response.json({
  code: "VARIATION_FIELD_REQUIRED",
  action: "attach",
  marketplaceId,
  sellerSku: "CHILD",
  targetParentSku: "TARGET",
  message: "Amazon 要求再次提供現有商品資料。",
  requiredFields: [],
  preservedRequiredFields: [preservedLiquid()],
  ...override,
}, { status: 422 });
async function preserveLiquid(checked: boolean) {
  await act(async () => {
    renderer!.root.findByProps({
      "aria-label": "綁定 · 是否含液體 · 保留既有答案並加入本次檢查",
    }).props.onChange({ target: { checked } });
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
              before: body.preserveRequiredFields?.includes("contains_liquid_contents")
                ? [{ marketplace_id: marketplaceId, value: false }]
                : null,
              after: [{ marketplace_id: marketplaceId, value: false }],
            },
            ...(body.preserveRequiredFields ?? []).filter((name: string) => name !== "contains_liquid_contents").map((name: string) => ({
              name, label: name, before: [{ marketplace_id: marketplaceId, value: false }],
              after: [{ marketplace_id: marketplaceId, value: false }],
            })),
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
        createNodeMock: (element) => ["variation-required-fields-title", "variation-preserved-fields-title"].includes(element.props.id)
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
  preservedRequiredFields?: ReturnType<typeof preservedLiquid>[],
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
      preservedRequiredFields,
    },
  });
}
afterEach(async () => {
  if (renderer) await act(async () => renderer?.unmount());
  renderer = null;
  vi.unstubAllGlobals();
});

describe("variation workspace interactions", () => {
  it("offers an unchecked exact existing answer after missing-fact Preview and sends only its name after explicit selection", async () => {
    const focus = vi.fn();
    await mountStandalone(focus);
    vi.mocked(fetch).mockResolvedValueOnce(preservedFieldError());
    await click("檢查綁定內容");

    const checkbox = renderer!.root.findByProps({
      "aria-label": "綁定 · 是否含液體 · 保留既有答案並加入本次檢查",
    });
    expect(checkbox.props.type).toBe("checkbox");
    expect(checkbox.props.checked).toBe(false);
    expect(focus).toHaveBeenCalledOnce();
    const comparison = renderer!.root.findByProps({ "aria-label": "綁定 · 保留現有商品資料" });
    expect(comparison.findByType("tbody").findAllByType("td").slice(0, 2).map((cell) => cell.children.join(""))).toEqual(["否", "否"]);
    expect(output()).toContain("Amazon 要求再次提供此資料，答案保持不變");
    expect(output()).toContain("☆ 待確認");
    expect(renderer!.root.findAllByProps({ "aria-label": "是否含液體 · Value" })).toHaveLength(0);
    expect(renderer!.root.findByProps({ "aria-label": "Shape · Amazon 現有值" }).children).toEqual(["Pretzel"]);
    expect(renderer!.root.findByProps({ "aria-label": "檢查綁定內容" }).props.disabled).toBe(true);
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);

    await preserveLiquid(true);
    expect(renderer!.root.findByProps({ "aria-label": "檢查綁定內容" }).props.disabled).toBe(false);
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    await click("檢查綁定內容");
    const previews = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST").map(([, init]) => JSON.parse(String(init?.body)));
    expect(previews).toHaveLength(2);
    expect(previews[0]).not.toHaveProperty("preserveRequiredFields");
    expect(previews[1].preserveRequiredFields).toEqual(["contains_liquid_contents"]);
    expect(previews[1].requiredValues).toEqual({});
    expect(previews[1].idempotencyKey).not.toBe(previews[0].idempotencyKey);
    expect(renderer!.root.findByProps({ "aria-label": "確認綁定變體" }).props.disabled).toBe(false);
    const confirmation = renderer!.root.findByProps({ "aria-labelledby": "variation-preview-title" });
    const preservedRow = confirmation.findByType("tbody").findAllByType("tr").find((row) =>
      row.findByType("th").children.includes("是否含液體"),
    );
    expect(preservedRow?.findAllByType("td").map((cell) => cell.children.join(""))).toEqual(["否", "否"]);
    expect(output()).toContain("保留既有答案；Amazon 要求再次提供");
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(0);

    const staleConfirm = renderer!.root.findByProps({ "aria-label": "確認綁定變體" }).props.onClick;
    await preserveLiquid(false);
    expect(renderer!.root.findAllByProps({ "aria-label": "確認綁定變體" })).toHaveLength(0);
    await act(async () => staleConfirm());
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(0);
  });
  it("keeps the selected preservation name through confirmation and native cancellation without sending an answer", async () => {
    await mountStandalone();
    vi.mocked(fetch).mockResolvedValueOnce(preservedFieldError());
    await click("檢查綁定內容");
    await preserveLiquid(true);
    await click("檢查綁定內容");
    const previewBody = JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.body));
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({
      code: "ACTION_CANCELLED", message: "已取消確認",
    }, { status: 403 }));
    await click("確認綁定變體");
    const writes = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "PATCH");
    expect(writes).toHaveLength(1);
    expect(JSON.parse(String(writes[0][1]?.body))).toEqual(previewBody);
    expect(previewBody.preserveRequiredFields).toEqual(["contains_liquid_contents"]);
    expect(previewBody.requiredValues).toEqual({});
    expect(output()).toContain("尚未送出修改");
    expect(renderer!.root.findByProps({
      "aria-label": "綁定 · 是否含液體 · 保留既有答案並加入本次檢查",
    }).props.checked).toBe(true);
    expect(renderer!.root.findAllByProps({ "aria-label": "確認綁定變體" })).toHaveLength(0);
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2);
  });
  it.each(["missing", "answer", "selector"])("refuses confirmation if a VALID Preview omits or changes the preserved %s", async (change) => {
    await mountStandalone();
    vi.mocked(fetch).mockResolvedValueOnce(preservedFieldError());
    await click("檢查綁定內容");
    await preserveLiquid(true);
    const fixture = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementationOnce(async (input, init) => {
      const response = await fixture(input, init);
      const preview = await response.json();
      if (change === "missing") preview.changes = [];
      else if (change === "answer") preview.changes[0].after[0].value = true;
      else delete preview.changes[0].after[0].marketplace_id;
      return Response.json(preview);
    });
    await click("檢查綁定內容");
    expect(renderer!.root.findAllByProps({ "aria-label": "確認綁定變體" })).toHaveLength(0);
    expect(output()).toContain("未完整核對要保留的既有答案");
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2);
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(0);
  });
  it("requires confirmation again when new missing-fact evidence changes the displayed current answer", async () => {
    await mountStandalone();
    vi.mocked(fetch).mockResolvedValueOnce(preservedFieldError());
    await click("檢查綁定內容");
    await preserveLiquid(true);
    vi.mocked(fetch).mockResolvedValueOnce(preservedFieldError({
      preservedRequiredFields: [preservedLiquid(true)],
    }));
    await click("檢查綁定內容");
    const comparison = renderer!.root.findByProps({ "aria-label": "綁定 · 保留現有商品資料" });
    expect(comparison.findByType("tbody").findAllByType("td").slice(0, 2).map((cell) => cell.children.join(""))).toEqual(["是", "是"]);
    expect(renderer!.root.findByProps({
      "aria-label": "綁定 · 是否含液體 · 保留既有答案並加入本次檢查",
    }).props.checked).toBe(false);
    expect(renderer!.root.findByProps({ "aria-label": "檢查綁定內容" }).props.disabled).toBe(true);
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2);
  });
  it("keeps drafted blank facts when a Preview discovers a separately preserved fact", async () => {
    await mount();
    await change("是否含液體 · Value", "false");
    const preserved = {
      ...preservedLiquid(), name: "is_fragile", label: "Fragile",
    };
    vi.mocked(fetch).mockResolvedValueOnce(preservedFieldError({
      action: "detach", targetParentSku: null, preservedRequiredFields: [preserved],
    }));
    await click("檢查解除內容");
    expect(renderer!.root.findByProps({ "aria-label": "是否含液體 · Value" }).props.value).toBe("false");
    const checkbox = renderer!.root.findByProps({
      "aria-label": "解除 · Fragile · 保留既有答案並加入本次檢查",
    });
    expect(checkbox.props.checked).toBe(false);
    await act(async () => checkbox.props.onChange({ target: { checked: true } }));
    await click("檢查解除內容");
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.body));
    expect(body.requiredValues).toEqual({
      contains_liquid_contents: [{ marketplace_id: marketplaceId, value: false }],
    });
    expect(body.preserveRequiredFields).toEqual(["is_fragile"]);
  });
  it("shows preservation returned by fresh preparation without preselecting it or creating answer inputs", async () => {
    await mountStandalone(undefined, undefined, [preservedLiquid()]);
    expect(renderer!.root.findByProps({
      "aria-label": "綁定 · 是否含液體 · 保留既有答案並加入本次檢查",
    }).props.checked).toBe(false);
    expect(renderer!.root.findAllByProps({ "aria-label": "是否含液體 · Value" })).toHaveLength(0);
    expect(renderer!.root.findByProps({ "aria-label": "檢查綁定內容" }).props.disabled).toBe(true);
    expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method)).toBe(true);
  });
  it.each(["preview", "confirmation"])("discards stale preservation evidence after %s drift and offers an explicit reread", async (stage) => {
    await mountStandalone();
    vi.mocked(fetch).mockResolvedValueOnce(preservedFieldError());
    await click("檢查綁定內容");
    await preserveLiquid(true);
    if (stage === "confirmation") await click("檢查綁定內容");
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({
      code: stage === "preview" ? "VARIATION_REQUIREMENTS_CHANGED" : "PREVIEW_CHANGED",
      message: "商品資料已變更，請重新讀取。",
    }, { status: 409 }));
    await click(stage === "preview" ? "檢查綁定內容" : "確認綁定變體");
    expect(renderer!.root.findAllByProps({ "aria-label": "綁定 · 保留現有商品資料" })).toHaveLength(0);
    expect(renderer!.root.findAllByProps({ "aria-label": "確認綁定變體" })).toHaveLength(0);
    const reload = renderer!.root.findAllByType("button").find((button) => button.children.includes("重新讀取必填欄位"));
    expect(reload).toBeDefined();
    expect(reload!.props.disabled).toBe(false);
    expect(output()).not.toContain("結果待確認 · 已停止後續寫入");
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2);
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(stage === "preview" ? 0 : 1);
  });
  it.each([
    ["different stage", { action: "detach" }],
    ["different marketplace", { marketplaceId: "A2EUQ1WTGCTBG2" }],
    ["different source", { sellerSku: "OTHER" }],
    ["different target", { targetParentSku: "OTHER" }],
    ["missing binding", { targetParentSku: undefined }],
    ["wrong error code", { code: "PREVIEW_CHANGED" }],
    ["editable preservation", { preservedRequiredFields: [{ ...preservedLiquid(), editable: true }] }],
    ["missing answer", { preservedRequiredFields: [{ ...preservedLiquid(), values: [] }] }],
  ])("does not expose a preservation action from %s metadata", async (_name, override) => {
    await mountStandalone();
    vi.mocked(fetch).mockResolvedValueOnce(preservedFieldError(override));
    await click("檢查綁定內容");
    expect(renderer!.root.findAllByProps({ "aria-label": "綁定 · 保留現有商品資料" })).toHaveLength(0);
    expect(renderer!.root.findAllByProps({ "aria-label": "是否含液體 · Value" })).toHaveLength(0);
    expect(renderer!.root.findAllByProps({ "aria-label": "確認綁定變體" })).toHaveLength(0);
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(0);
  });
  it.each(["target", "source", "marketplace", "close"])("clears preserved evidence and selections on %s context change", async (context) => {
    await mountStandalone();
    vi.mocked(fetch).mockResolvedValueOnce(preservedFieldError());
    await click("檢查綁定內容");
    await preserveLiquid(true);
    if (context === "marketplace") await change("Amazon 站點", "A2EUQ1WTGCTBG2");
    else if (context === "close") await click("返回 AMZ.API 首頁");
    else await act(async () => renderer!.root.findByProps({ "data-variation-lookup": context }).props.onClick());
    expect(renderer!.root.findAllByProps({ "aria-label": "綁定 · 保留現有商品資料" })).toHaveLength(0);
    expect(renderer!.root.findAllByProps({ "aria-label": "確認綁定變體" })).toHaveLength(0);
    if (context === "target") {
      await click("檢查綁定內容");
      const body = JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.body));
      expect(body).not.toHaveProperty("preserveRequiredFields");
    }
  });
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
  it("shows bounded public Preview diagnostics without treating the local response status as Amazon status", async () => {
    await mountStandalone();
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json(
        {
          code: "INVALID_LISTING_REQUEST",
          upstreamCode: "4000002",
          operation: "patchListingsItemPreview",
          requestId: "PREVIEW-DIAGNOSTIC-1",
          message: "'Contains Liquid Contents?' is required but missing.",
          issues: [
            {
              code: "4000002",
              severity: "ERROR",
              message: "Do not expose raw issue message.",
              attributeNames: ["contains_liquid_contents"],
              categories: ["MISSING_ATTRIBUTE"],
              marketplaceIds: [marketplaceId],
            },
          ],
        },
        { status: 422 },
      ),
    );
    await click("檢查綁定內容");
    const details = renderer!.root.findByProps({
      "aria-label": "Amazon 檢查詳情",
    });
    expect(details.type).toBe("details");
    expect(details.props.open).not.toBe(true);
    expect(output()).toContain("查看 Amazon 檢查詳情");
    expect(output()).toContain("本機回覆 HTTP 狀態");
    expect(output()).toContain("不代表 Amazon HTTP 狀態");
    expect(output()).toContain("INVALID_LISTING_REQUEST");
    expect(output()).toContain("4000002");
    expect(output()).toContain("patchListingsItemPreview");
    expect(output()).toContain("PREVIEW-DIAGNOSTIC-1");
    expect(output()).toContain("contains_liquid_contents");
    expect(output()).toContain("MISSING_ATTRIBUTE");
    expect(output()).not.toContain("Do not expose raw issue message.");
    expect(output()).toContain(
      "'Contains Liquid Contents?' is required but missing.",
    );
    expect(
      renderer!.root.findAllByProps({ "aria-label": "確認綁定變體" }),
    ).toHaveLength(0);
    expect(
      vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(1);
    expect(
      vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "PATCH"),
    ).toHaveLength(0);
  });
  it("clears the previous diagnostics as soon as a fresh Preview starts", async () => {
    await mountStandalone();
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json(
        {
          code: "VALIDATION_FAILED",
          message: "商品資料缺漏。",
          requestId: "OLD-PREVIEW",
          issues: [],
        },
        { status: 422 },
      ),
    );
    await click("檢查綁定內容");
    expect(output()).toContain("OLD-PREVIEW");
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    await click("檢查綁定內容");
    expect(
      renderer!.root.findAllByProps({ "aria-label": "Amazon 檢查詳情" }),
    ).toHaveLength(0);
    expect(output()).not.toContain("OLD-PREVIEW");
    await act(async () =>
      finish(
        Response.json(
          {
            code: "UPSTREAM_UNAVAILABLE",
            message: "請稍後再檢查。",
            requestId: "NEW-PREVIEW",
            issues: [],
          },
          { status: 502 },
        ),
      ),
    );
    expect(output()).toContain("NEW-PREVIEW");
    expect(output()).not.toContain("OLD-PREVIEW");
    expect(
      vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(2);
    await click("檢查綁定內容");
    expect(
      renderer!.root.findAllByProps({ "aria-label": "Amazon 檢查詳情" }),
    ).toHaveLength(0);
    expect(output()).not.toContain("NEW-PREVIEW");
    expect(
      renderer!.root.findByProps({ "aria-label": "確認綁定變體" }).props.disabled,
    ).toBe(false);
  });
  it("clears diagnostics when leaving the variation workspace", async () => {
    await mountStandalone();
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json(
        {
          code: "VALIDATION_FAILED",
          message: "商品資料缺漏。",
          requestId: "CLOSED-PREVIEW",
          issues: [],
        },
        { status: 422 },
      ),
    );
    await click("檢查綁定內容");
    expect(output()).toContain("CLOSED-PREVIEW");
    await click("返回 AMZ.API 首頁");
    expect(
      renderer!.root.findAllByProps({ "aria-label": "Amazon 檢查詳情" }),
    ).toHaveLength(0);
  });
  it("hides malformed and private diagnostic values without creating inputs or retrying", async () => {
    await mountStandalone();
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json(
        {
          code: "INVALID_LISTING_REQUEST",
          message: "request ?authorization=SYNTHETIC_PRIVATE",
          requestId: "https://example.invalid/SYNTHETIC_PRIVATE",
          upstreamCode: "A1234567890123",
          sellerId: "SYNTHETIC_PRIVATE",
          operation: "unknownOperation",
          issues: [
            {
              code: "4000002",
              severity: "ERROR",
              message: "SYNTHETIC_PRIVATE",
              attributeNames: ["https://example.invalid/SYNTHETIC_PRIVATE"],
              categories: {},
              marketplaceIds: ["A1234567890123"],
            },
            { severity: ["ERROR"], message: "SYNTHETIC_PRIVATE" },
          ],
        },
        { status: 422 },
      ),
    );
    await click("檢查綁定內容");
    expect(output()).not.toContain("SYNTHETIC_PRIVATE");
    expect(output()).not.toContain("A1234567890123");
    expect(output()).not.toContain("unknownOperation");
    expect(output()).toContain("格式不符或已隱藏");
    expect(output()).toContain("未全部列出");
    expect(
      renderer!.root.findAllByProps({ "aria-label": "是否含液體 · Value" }),
    ).toHaveLength(0);
    expect(
      vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(1);
    expect(
      vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "PATCH"),
    ).toHaveLength(0);
  });
  it("shows the diagnostic issue cap and omitted count without implying the public response is complete", async () => {
    await mountStandalone();
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json(
        {
          code: "VALIDATION_FAILED",
          message: "商品資料缺漏。",
          issues: Array.from({ length: 25 }, (_, index) => ({
            code: `ISSUE_${index}`,
            severity: "ERROR",
          })),
        },
        { status: 422 },
      ),
    );
    await click("檢查綁定內容");
    const table = renderer!.root.findByProps({
      "aria-label": "Amazon 公開問題欄位",
    });
    expect(table.findByType("tbody").findAllByType("tr")).toHaveLength(20);
    expect(output()).toContain("ISSUE_19");
    expect(output()).not.toContain("ISSUE_20");
    expect(output()).toContain("公開回覆未列出");
    const omission = renderer!.root
      .findAllByType("p")
      .find((node) => node.children.includes("未全部列出：另有 "));
    expect(omission?.children.join("")).toContain("另有 5 則問題");
  });
  it("clears stale diagnostics when editing the form or replacing the target context", async () => {
    await mount();
    await change("是否含液體 · Value", "false");
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json(
        { code: "VALIDATION_FAILED", message: "商品資料缺漏。", issues: [] },
        { status: 422 },
      ),
    );
    await click("檢查解除內容");
    expect(
      renderer!.root.findAllByProps({ "aria-label": "Amazon 檢查詳情" }),
    ).toHaveLength(1);
    await change("是否含液體 · Value", "true");
    expect(
      renderer!.root.findAllByProps({ "aria-label": "Amazon 檢查詳情" }),
    ).toHaveLength(0);
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json(
        { code: "VALIDATION_FAILED", message: "商品資料缺漏。", issues: [] },
        { status: 422 },
      ),
    );
    await click("檢查解除內容");
    expect(
      renderer!.root.findAllByProps({ "aria-label": "Amazon 檢查詳情" }),
    ).toHaveLength(1);
    await act(async () =>
      renderer!.root
        .findByProps({ "data-variation-lookup": "target" })
        .props.onClick(),
    );
    expect(
      renderer!.root.findAllByProps({ "aria-label": "Amazon 檢查詳情" }),
    ).toHaveLength(0);
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
    expect(output()).toContain(override.code === "PREVIEW_CHANGED" ? "重新讀取必填欄位" : "預檢未通過");
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
