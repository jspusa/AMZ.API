import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import ImageSharedSelection from "../src/renderer/src/components/image-shared-selection";
import type { ImageFolderRow } from "../src/renderer/src/image-folder-import";

const marketplaceId = "ATVPDKIKX0DER";
const image = (name: string) => new File(["image"], name, { type: "image/jpeg" });
const member = (sellerSku: string) => ({ sellerSku, asin: "B000000001", title: `Product ${sellerSku}`, productType: "PET_FOOD", status: [], role: "child", parentSku: "PARENT", childSkus: [], variationTheme: "SIZE", dimensions: [], fba: true, issues: [], relationshipSources: ["relationships"] });
const family = { mode: "live", marketplaceId, queriedSku: "AFA21AM", queriedRole: "child", queried: member("AFA21AM"), parent: null, children: [member("AFA21AM"), member("AFA22AM")], excludedChildren: [], variationTheme: "SIZE", dimensionNames: [], familyComplete: true, fetchedAt: "2026-09-17T01:00:00.000Z", requestIds: [], writable: false, boundaries: [], notice: "" };
let renderer: ReactTestRenderer | null = null;
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = null; vi.unstubAllGlobals(); });

it("discovers related FBA SKUs from a numbered file while only selected targets enter the draft", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", { fbaOS: { app: { onContextInvalidated: () => () => undefined } } });
  const fetchMock = vi.fn(async () => Response.json(family));
  vi.stubGlobal("fetch", fetchMock);
  let rows: ImageFolderRow[] = [];
  await act(async () => { renderer = create(<ImageSharedSelection files={[image("AFA21AM_09_系列底圖_模板.jpg")]} marketplaceId={marketplaceId} disabled={false} onRowsChange={value => { rows = value; }} onBusyChange={() => undefined} />); });
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(fetchMock.mock.calls[0][0]).toContain("sku=AFA21AM");
  expect(rows.map(row => row.sellerSku)).toEqual(["AFA21AM"]);
  expect(JSON.stringify(renderer!.toJSON())).toContain("Product AFA22AM");
  const related = renderer!.root.findByProps({ "aria-label": "AFA21AM_09_系列底圖_模板.jpg 套用至 AFA22AM" });
  expect(related.props.checked).toBe(false);
  await act(async () => related.props.onChange({ target: { checked: true } }));
  expect(rows.map(row => ({ sku: row.sellerSku, slots: row.images.map(item => item.slot) }))).toEqual([{ sku: "AFA21AM", slots: [8] }, { sku: "AFA22AM", slots: [8] }]);
});

it("accepts manual position and multiple targets for an unnumbered image without guessing a family", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", {});
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  let rows: ImageFolderRow[] = [];
  await act(async () => { renderer = create(<ImageSharedSelection files={[image("shared.jpg")]} marketplaceId={marketplaceId} disabled={false} onRowsChange={value => { rows = value; }} onBusyChange={() => undefined} />); });
  expect(rows[0].sellerSku).toBeNull();
  expect(rows[0].errors.length).toBeGreaterThan(0);
  expect(fetchMock).not.toHaveBeenCalled();
  await act(async () => renderer!.root.findByProps({ "aria-label": "共用圖片位置：shared.jpg" }).props.onChange({ target: { value: "8" } }));
  await act(async () => renderer!.root.findByProps({ "aria-label": "套用 SKU：shared.jpg" }).props.onChange({ target: { value: "EXACT-SKU\nSecond-SKU" } }));
  expect(rows.map(row => ({ sku: row.sellerSku, slot: row.images[0].slot, errors: row.errors }))).toEqual([{ sku: "EXACT-SKU", slot: 8, errors: [] }, { sku: "Second-SKU", slot: 8, errors: [] }]);
  await act(async () => renderer!.root.findByProps({ "aria-label": "移除圖片：shared.jpg" }).props.onClick());
  expect(rows).toEqual([]);
});

it("drops late family results when the security context changes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let invalidated!: () => void;
  vi.stubGlobal("window", { fbaOS: { app: { onContextInvalidated: (listener: () => void) => { invalidated = listener; return () => undefined; } } } });
  let finish!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
  let rows: ImageFolderRow[] = []; const busy: boolean[] = [];
  await act(async () => { renderer = create(<ImageSharedSelection files={[image("AFA21AM_09.jpg")]} marketplaceId={marketplaceId} disabled={false} onRowsChange={value => { rows = value; }} onBusyChange={value => busy.push(value)} />); });
  expect(busy.at(-1)).toBe(true);
  await act(async () => invalidated());
  await act(async () => finish(Response.json(family)));
  expect(rows).toEqual([]);
  expect(busy.at(-1)).toBe(false);
  expect(JSON.stringify(renderer!.toJSON())).not.toContain("Product AFA22AM");
});

it("stops remaining automatic lookups after an authentication failure", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", {});
  const fetchMock = vi.fn(async () => Response.json({ message: "Unavailable" }, { status: 403 })); vi.stubGlobal("fetch", fetchMock);
  await act(async () => { renderer = create(<ImageSharedSelection files={[image("AFA21AM_09.jpg"), image("AFA22AM_08.jpg")]} marketplaceId={marketplaceId} disabled={false} onRowsChange={() => undefined} onBusyChange={() => undefined} />); });
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(JSON.stringify(renderer!.toJSON())).toContain("其餘系列查詢未啟動");
});

it("keeps a filename parent visible but blocks it while offering only FBA children", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("window", {});
  const parent = { ...member("PARENT"), role: "parent", fba: false, parentSku: null, childSkus: ["AFA21AM", "AFA22AM"] };
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...family, queriedSku: "PARENT", queriedRole: "parent", queried: parent, parent, familyComplete: false })));
  let rows: ImageFolderRow[] = [];
  await act(async () => { renderer = create(<ImageSharedSelection files={[image("PARENT_09.jpg")]} marketplaceId={marketplaceId} disabled={false} onRowsChange={value => { rows = value; }} onBusyChange={() => undefined} />); });
  expect(rows.find(row => row.sellerSku === "PARENT")?.errors.join(" ")).toContain("父商品");
  expect(JSON.stringify(renderer!.toJSON())).toContain("系列資料未完整");
  expect(renderer!.root.findAllByProps({ "aria-label": "PARENT_09.jpg 套用至 PARENT" })).toHaveLength(0);
});

async function mountSuggestions(files = [image("AFA21AM_09.jpg")], response = family) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("window", {});
  const fetchMock = vi.fn(async () => Response.json(response)); vi.stubGlobal("fetch", fetchMock);
  let rows: ImageFolderRow[] = [];
  await act(async () => { renderer = create(<ImageSharedSelection files={files} marketplaceId={marketplaceId} disabled={false} onRowsChange={value => { rows = value; }} onBusyChange={() => undefined} />); });
  return { rows: () => rows, fetchMock };
}

it("selects all suggestions and clears suggested selections while preserving manually added exact SKUs", async () => {
  const { rows, fetchMock } = await mountSuggestions(undefined, { ...family, children: [...family.children, member("AFA23AM")] });
  await act(async () => renderer!.root.findByProps({ "aria-label": "套用 SKU：AFA21AM_09.jpg" }).props.onChange({ target: { value: "AFA21AM\nManual-SKU\nAFA23AM" } }));
  const all = () => renderer!.root.findByProps({ "aria-label": "全選同系列建議：AFA21AM_09.jpg" });
  const clear = () => renderer!.root.findByProps({ "aria-label": "取消全選同系列建議：AFA21AM_09.jpg" });
  expect(all().props.disabled).toBe(false);
  await act(async () => all().props.onClick());
  expect(rows().map(row => row.sellerSku)).toEqual(["AFA21AM", "Manual-SKU", "AFA23AM", "AFA22AM"]);
  expect(all().props.disabled).toBe(true);
  await act(async () => clear().props.onClick());
  expect(rows().map(row => row.sellerSku)).toEqual(["Manual-SKU", "AFA23AM"]);
  expect(clear().props.disabled).toBe(true);
  expect(renderer!.root.findByProps({ "aria-label": "AFA21AM_09.jpg 套用至 AFA23AM" }).props.checked).toBe(true);
  expect(fetchMock).toHaveBeenCalledOnce();
});

it("enforces the whole-batch 30 distinct SKU cap without blocking a SKU already assigned to another image", async () => {
  const { rows } = await mountSuggestions([image("AFA21AM_09.jpg"), image("shared.jpg")]);
  const other = Array.from({ length: 29 }, (_, index) => `MANUAL-${index + 1}`);
  await act(async () => renderer!.root.findByProps({ "aria-label": "套用 SKU：shared.jpg" }).props.onChange({ target: { value: other.join("\n") } }));
  const all = () => renderer!.root.findByProps({ "aria-label": "全選同系列建議：AFA21AM_09.jpg" });
  const sibling = () => renderer!.root.findByProps({ "aria-label": "AFA21AM_09.jpg 套用至 AFA22AM" });
  expect(all().props.disabled).toBe(true);
  expect(sibling().props.disabled).toBe(true);
  await act(async () => all().props.onClick());
  expect(rows().map(row => row.sellerSku)).not.toContain("AFA22AM");
  expect(JSON.stringify(renderer!.toJSON())).toContain("每批最多 30 個不同 SKU");
  await act(async () => renderer!.root.findByProps({ "aria-label": "套用 SKU：shared.jpg" }).props.onChange({ target: { value: ["AFA22AM", ...other.slice(1)].join("\n") } }));
  expect(all().props.disabled).toBe(false);
  expect(sibling().props.disabled).toBe(false);
  await act(async () => all().props.onClick());
  expect(rows().find(row => row.sellerSku === "AFA22AM")?.fileCount).toBe(2);
  expect(new Set(rows().map(row => row.sellerSku)).size).toBe(30);
});

it("presents one associated whole-row label per suggestion and keeps incomplete-family bulk selection unavailable", async () => {
  await mountSuggestions(undefined, { ...family, familyComplete: false });
  const list = renderer!.root.findByProps({ "aria-label": "同系列商品清單：AFA21AM_09.jpg" });
  expect(list.type).toBe("ul");
  expect(list.findAllByType("li")).toHaveLength(2);
  const row = list.findAllByType("label")[1];
  const checkbox = row.findByType("input");
  expect(row.props.htmlFor).toBe(checkbox.props.id);
  expect(row.findByType("strong").children).toEqual(["AFA22AM"]);
  expect(row.findByType("span").children).toEqual(["Product AFA22AM"]);
  expect(row.findByType("small").children).toEqual(["B000000001"]);
  expect(renderer!.root.findByProps({ "aria-label": "全選同系列建議：AFA21AM_09.jpg" }).props.disabled).toBe(true);
  expect(checkbox.props.disabled).toBe(false);
});
