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
async function mount() {
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
        return Response.json(family(input.includes("sku=TARGET")));
      return Response.json(
        prepared(input.includes("action=detach") ? "detach" : "attach"),
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
afterEach(async () => {
  if (renderer) await act(async () => renderer?.unmount());
  renderer = null;
  vi.unstubAllGlobals();
});

describe("variation workspace interactions", () => {
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
