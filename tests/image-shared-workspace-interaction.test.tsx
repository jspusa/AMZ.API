import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import ImageFolderWorkspace from "../src/renderer/src/components/image-folder-workspace";

const marketplaceId = "ATVPDKIKX0DER";
let renderer: ReactTestRenderer | null = null;
const button = (name: string) => renderer!.root.findAllByType("button").find(node => node.children.join("") === name)!;
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = null; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function mount(selectedSlotReplacement = true, corruptUntouched = false) {
  const calls: Array<{ path: string; method: string; body: any }> = [];
  const original = Array.from({ length: 10 }, (_, slot) => `https://images.example/old-${slot + 1}.jpg`);
  let preview: any;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", { setTimeout, clearTimeout, fbaOS: { app: { onContextInvalidated: () => () => undefined } } });
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
    calls.push({ path, method, body });
    if (path.includes("variation-family")) return Response.json({ message: "家族尚未完整讀取" }, { status: 422 });
    if (path === "/api/uploads/listing-images") return Response.json({ amazonUrl: "https://images.example/new-shared.jpg", readyForAmazon: true, expiresAt: new Date(Date.now() + 60 * 60_000).toISOString() });
    if (method === "POST") {
      const rows = body.rows.map((row: any) => ({ sellerSku: row.sellerSku, asin: "B000000001", title: "Shared image product", previousUrls: original,
        requestedUrls: original.map((url, slot) => corruptUntouched && slot === 0 ? null : row.urls[slot] ?? url), changedSlots: [9], deletedSlots: [], state: "ready", code: null, message: null, requestId: null, acceptedAt: null }));
      preview = { capability: "listing-image-batch-v1", batchId: "batch-one", reviewToken: "review-one", marketplaceId, mode: "live", replacementMode: "selected-slots", phase: "ready", expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), rows,
        totals: { skus: rows.length, ready: rows.length, blocked: 0, unchanged: 0, submitted: 0, accepted: 0, verified: 0, deletedSlots: 0 }, message: null };
      return Response.json(preview);
    }
    if (method === "PATCH") return Response.json({ ...preview, phase: "completed", rows: preview.rows.map((row: any) => ({ ...row, state: "accepted" })) });
    return Response.json({ capability: "listing-image-batch-v1", maxSkus: 30, maxImagesPerSku: 10, replacementMode: "complete", confirmationMode: "native", selectedSlotReplacement });
  }));
  await act(async () => { renderer = create(<ImageFolderWorkspace marketplaceId={marketplaceId} onBusyChange={() => undefined} />); });
  return calls;
}

async function selectSharedImage() {
  const file = new File(["synthetic image"], "AFA21AM_09_系列底圖_模板.jpg", { type: "image/jpeg" });
  await act(async () => { renderer!.root.findByProps({ "aria-label": "選擇單張或多張圖片" }).props.onChange({ target: { files: [file], value: "" } }); });
}

it("accepts one loose numbered shared image and previews only position 9 without clearing the other positions", async () => {
  const calls = await mount();
  await selectSharedImage();
  expect(calls.every(call => call.method === "GET")).toBe(true);
  await act(async () => { await button("準備圖片並核對 1 個 SKU").props.onClick(); });
  const request = calls.find(call => call.method === "POST" && call.path.includes("listing-images-batch"))!;
  expect(request.body).toEqual({ marketplaceId, replacementMode: "selected-slots", rows: [{ sellerSku: "AFA21AM", urls: [null, null, null, null, null, null, null, null, "https://images.example/new-shared.jpg", null] }] });
  expect(JSON.stringify(renderer!.toJSON())).toContain("其他位置全部保留");
  expect(button("一次指紋確認並更新 1 個 SKU").props.disabled).toBe(true);
  await act(async () => renderer!.root.findByProps({ "aria-label": "確認本批圖片變更" }).props.onChange({ target: { checked: true } }));
  await act(async () => { await button("一次指紋確認並更新 1 個 SKU").props.onClick(); });
  expect(calls.filter(call => call.method === "PATCH").map(call => call.body)).toEqual([{ marketplaceId, batchId: "batch-one", reviewToken: "review-one", selectedSlotsAcknowledged: true }]);
});

it("keeps loose images unavailable on an older Notebook Key while leaving folder updates available", async () => {
  await mount(false);
  expect(button("選擇圖片").props.disabled).toBe(true);
  expect(button("選擇資料夾").props.disabled).toBe(false);
});

it("rejects a selected-slot review that changes an untouched original image", async () => {
  const calls = await mount(true, true);
  await selectSharedImage();
  await act(async () => { await button("準備圖片並核對 1 個 SKU").props.onClick(); });
  expect(JSON.stringify(renderer!.toJSON())).toContain("圖片位置與所選內容不一致");
  expect(button("一次指紋確認並更新 1 個 SKU")).toBeUndefined();
  expect(calls.filter(call => call.method === "PATCH")).toHaveLength(0);
});

it("prepares the same selected file for each manually entered SKU and resets review when targets change", async () => {
  const calls = await mount();
  await selectSharedImage();
  const targets = () => renderer!.root.findByProps({ "aria-label": "套用 SKU：AFA21AM_09_系列底圖_模板.jpg" });
  await act(async () => targets().props.onChange({ target: { value: "AFA21AM\nAFA22AM\nAFA23AM" } }));
  await act(async () => { await button("準備圖片並核對 3 個 SKU").props.onClick(); });
  const uploads = calls.filter(call => call.path === "/api/uploads/listing-images");
  expect(uploads.map(call => call.body.get("sellerSku"))).toEqual(["AFA21AM", "AFA22AM", "AFA23AM"]);
  expect(uploads.every(call => call.body.get("file").name === "AFA21AM_09_系列底圖_模板.jpg")).toBe(true);
  expect(button("一次指紋確認並更新 3 個 SKU")).toBeTruthy();
  await act(async () => targets().props.onChange({ target: { value: "AFA21AM\nAFA23AM" } }));
  expect(button("一次指紋確認並更新 3 個 SKU")).toBeUndefined();
  expect(button("準備圖片並核對 2 個 SKU")).toBeTruthy();
  expect(calls.filter(call => call.method === "PATCH")).toHaveLength(0);
});

it("accepts a direct loose-file drop and rejects mixed folder/file drops without replacing the current selection", async () => {
  const calls = await mount();
  const file = new File(["synthetic image"], "AFA21AM_09_系列底圖_模板.jpg", { type: "image/jpeg" });
  const drop = renderer!.root.findByProps({ className: "image-folder-drop" });
  await act(async () => { await drop.props.onDrop({ preventDefault() {}, dataTransfer: { files: [file], items: [{ webkitGetAsEntry: () => ({ isFile: true, isDirectory: false }) }] } }); });
  expect(button("準備圖片並核對 1 個 SKU")).toBeTruthy();
  await act(async () => { await drop.props.onDrop({ preventDefault() {}, dataTransfer: { files: [file], items: [{ webkitGetAsEntry: () => ({ isFile: true, isDirectory: false }) }, { webkitGetAsEntry: () => ({ isFile: false, isDirectory: true }) }] } }); });
  expect(JSON.stringify(renderer!.toJSON())).toContain("圖片與資料夾分開拖入");
  expect(button("準備圖片並核對 1 個 SKU")).toBeTruthy();
  expect(calls.every(call => call.method === "GET")).toBe(true);
});
