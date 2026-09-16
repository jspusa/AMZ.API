import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ImageFolderWorkspace from "../src/renderer/src/components/image-folder-workspace";
import ImageWorkspaceDrawer from "../src/renderer/src/components/image-workspace-drawer";

const marketplaceId = "ATVPDKIKX0DER";
const initialNow = Date.parse("2026-09-14T08:00:00.000Z");
const sourceExpiry = new Date(initialNow + 60 * 60_000).toISOString();
beforeEach(() => { vi.spyOn(Date, "now").mockReturnValue(initialNow); });
let renderer: ReactTestRenderer | null = null;
const text = () => JSON.stringify(renderer?.toJSON());
const button = (name: string) => renderer!.root.findAllByType("button").find(node => node.children.join("") === name)!;
function file(order: string) {
  const result = new File(["image"], `AFA12AM_${order}.jpg`, { type: "image/jpeg" });
  Object.defineProperty(result, "webkitRelativePath", { value: `AF_US組圖_AFA12AM_V11/${result.name}` });
  return result;
}
const urls = ["https://images.example/01.jpg", "https://images.example/02.jpg", ...Array.from({ length: 8 }, () => null)];
const batch = { capability: "listing-image-batch-v1", batchId: "image-batch.11111111-1111-4111-8111-111111111111", reviewToken: "image-review.22222222-2222-4222-8222-222222222222", marketplaceId, mode: "live", replacementMode: "complete", phase: "ready", expiresAt: new Date(initialNow + 15 * 60_000).toISOString(), rows: [{ sellerSku: "AFA12AM", asin: "B000000001", title: "Product", previousUrls: [...urls.slice(0, 2), "https://images.example/old-third.jpg", ...urls.slice(3)], requestedUrls: urls, changedSlots: [1, 2, 3], deletedSlots: [3], state: "ready", code: null, message: null, requestId: null, acceptedAt: null }], totals: { skus: 1, ready: 1, blocked: 0, unchanged: 0, submitted: 0, accepted: 0, verified: 0, deletedSlots: 1 }, message: null };
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = null; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("prepares one complete folder, discloses old extras, and requires acknowledgement before one whole-batch submission", async () => {
  const uploads: string[] = [];
  const writes: Array<{ method: string; body: any }> = [];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", { setTimeout, clearTimeout, fbaOS: { app: { onContextInvalidated: () => () => undefined } } });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/uploads/listing-images") {
      const form = init!.body as FormData;
      expect(form.get("batchMode")).toBe("true");
      const image = form.get("file") as File;
      uploads.push(image.name);
      return Response.json({ amazonUrl: urls[uploads.length - 1], readyForAmazon: true, expiresAt: sourceExpiry });
    }
    if (init?.method === "POST" || init?.method === "PATCH") {
      writes.push({ method: init.method, body: JSON.parse(init.body as string) });
      return Response.json(init.method === "PATCH" ? { ...batch, phase: "completed", rows: [{ ...batch.rows[0], state: "accepted" }], totals: { ...batch.totals, submitted: 1, accepted: 1 } } : batch);
    }
    return Response.json({ capability: "listing-image-batch-v1", maxSkus: 30, maxImagesPerSku: 10, replacementMode: "complete", confirmationMode: "native", readbackRecovery: "exact-sku-v1" });
  }));
  await act(async () => { renderer = create(<ImageFolderWorkspace marketplaceId={marketplaceId} onBusyChange={() => undefined} />); });
  await act(async () => { await renderer!.root.findByProps({ "aria-label": "選擇商品資料夾" }).props.onChange({ target: { files: [file("02"), file("01")], value: "" } }); });
  expect(uploads).toEqual([]);
  await act(async () => { await button("準備圖片並核對 1 個 SKU").props.onClick(); });
  expect(uploads).toEqual(["AFA12AM_01.jpg", "AFA12AM_02.jpg"]);
  expect(text()).toContain("保留 1 小時");
  expect(text()).toContain(new Date(sourceExpiry).toLocaleString("zh-TW"));
  expect(text()).toContain(new Date(batch.expiresAt).toLocaleString("zh-TW"));
  expect(writes).toEqual([{ method: "POST", body: { marketplaceId, replacementMode: "complete", rows: [{ sellerSku: "AFA12AM", urls }] } }]);
  expect(renderer!.root.findAllByProps({ className: "image-folder-deletions" })[0].children.join("")).toBe("清除第 3 張");
  expect(text()).toContain("查看逐張變更（原圖／新圖）");
  expect(renderer!.root.findByProps({ "aria-label": "AFA12AM 逐張圖片變更" }).findAllByType("tbody")[0].findAllByType("tr")).toHaveLength(3);
  expect(text()).toContain("第 1 張原圖");
  expect(button("一次指紋確認並更新 1 個 SKU").props.disabled).toBe(true);
  await act(async () => renderer!.root.findByProps({ type: "checkbox" }).props.onChange({ target: { checked: true } }));
  await act(async () => { await button("一次指紋確認並更新 1 個 SKU").props.onClick(); });
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual({ method: "PATCH", body: { marketplaceId, batchId: batch.batchId, reviewToken: batch.reviewToken, completeReplacementAcknowledged: true } });
  expect(text()).toContain("Amazon 已接受");
});

async function mountSafetyFixture(options: { upload?: () => Promise<Response>; unavailable?: boolean; uncertainCommit?: boolean; wholeWorkspace?: boolean; legacyReadback?: boolean } = {}) {
  const calls: Array<{ method: string; path: string }> = [];
  const busy: boolean[] = [];
  const listeners = new Set<() => void>();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn(), confirm: vi.fn(() => true), setTimeout, clearTimeout, fbaOS: { app: { onContextInvalidated: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); } } } });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? "GET", path: url.split("?")[0] });
    if (url === "/api/uploads/listing-images") return options.upload ? options.upload() : Response.json({ amazonUrl: urls[0], readyForAmazon: true, expiresAt: sourceExpiry });
    const oneImage = { ...batch, rows: [{ ...batch.rows[0], requestedUrls: [urls[0], ...Array.from({ length: 9 }, () => null)] }] };
    if (init?.method === "POST") return Response.json(oneImage);
    if (init?.method === "PATCH") {
      if (options.uncertainCommit) throw new Error("Network disconnected");
      return Response.json({ ...oneImage, phase: "completed" });
    }
    if (url.includes("batchId=")) return Response.json({ ...oneImage, phase: "completed", rows: [{ ...oneImage.rows[0], state: "accepted" }], totals: { ...batch.totals, submitted: 1, accepted: 1 } });
    return options.unavailable ? Response.json({ message: "Unavailable" }, { status: 404 }) : Response.json({ capability: "listing-image-batch-v1", maxSkus: 30, maxImagesPerSku: 10, replacementMode: "complete", confirmationMode: "native", ...(options.legacyReadback ? {} : { readbackRecovery: "exact-sku-v1" }) });
  }));
  await act(async () => { renderer = create(options.wholeWorkspace
    ? <ImageWorkspaceDrawer initialMarketplaceId={marketplaceId} initialTab="folders" presentation="workspace" onClose={() => undefined} onBusyChange={value => busy.push(value)} />
    : <ImageFolderWorkspace marketplaceId={marketplaceId} onBusyChange={value => busy.push(value)} />); });
  return { calls, busy, invalidate: () => [...listeners].forEach(listener => listener()) };
}
async function chooseOne() {
  await act(async () => { renderer!.root.findByProps({ "aria-label": "選擇商品資料夾" }).props.onChange({ target: { files: [file("01")], value: "" } }); });
}

it("keeps folder preparation disabled on an older Notebook Key", async () => {
  const fixture = await mountSafetyFixture({ unavailable: true });
  expect(text()).toContain("請更新桌面程式");
  expect(button("選擇資料夾").props.disabled).toBe(true);
  expect(fixture.calls).toEqual([{ method: "GET", path: "/api/sp-api/listing-images-batch" }]);
});

it("does not preview a complete replacement when the service cannot prove finite temporary retention", async () => {
  const fixture = await mountSafetyFixture({ upload: async () => Response.json({ amazonUrl: urls[0], readyForAmazon: true }) });
  await chooseOne();
  await act(async () => { await button("準備圖片並核對 1 個 SKU").props.onClick(); });
  expect(text()).toContain("暫存期限");
  expect(fixture.calls.filter(call => call.method === "POST").map(call => call.path)).toEqual(["/api/uploads/listing-images"]);
});

it("rechecks retained files only after an explicit preparation action when a temporary upload failed", async () => {
  let first = true;
  const fixture = await mountSafetyFixture({ upload: async () => {
    if (first) { first = false; return Response.json({ message: "暫時無法讀取" }, { status: 503 }); }
    return Response.json({ amazonUrl: urls[0], readyForAmazon: true, expiresAt: sourceExpiry });
  } });
  await chooseOne();
  await act(async () => { await button("準備圖片並核對 1 個 SKU").props.onClick(); });
  expect(text()).toContain("AFA12AM");
  expect(fixture.calls.filter(call => call.method === "POST")).toHaveLength(1);
  await act(async () => { await button("重新準備並核對").props.onClick(); });
  expect(fixture.calls.filter(call => call.method === "POST").map(call => call.path)).toEqual(["/api/uploads/listing-images", "/api/uploads/listing-images", "/api/sp-api/listing-images-batch"]);
  expect(button("一次指紋確認並更新 1 個 SKU").props.disabled).toBe(true);
});

it("retains the current folder review after an unreadable new drop", async () => {
  const fixture = await mountSafetyFixture();
  await chooseOne();
  await act(async () => { await renderer!.root.findByProps({ className: "image-folder-drop" }).props.onDrop({ preventDefault: () => undefined, dataTransfer: { items: [{ webkitGetAsEntry: () => null }] } }); });
  expect(text()).toContain("AFA12AM");
  expect(text()).toContain("原本的核對內容仍保留");
  expect(fixture.calls.filter(call => call.method !== "GET")).toHaveLength(0);
});

it("locks workspace navigation while a file is being prepared and discards late results after context invalidation", async () => {
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>(resolve => { finish = resolve; });
  const fixture = await mountSafetyFixture({ upload: () => pending, wholeWorkspace: true });
  await chooseOne();
  let preparing!: Promise<void>;
  await act(async () => { preparing = button("準備圖片並核對 1 個 SKU").props.onClick(); });
  expect(fixture.busy.at(-1)).toBe(true);
  expect(renderer!.root.findByProps({ id: "image-single-tab" }).props.disabled).toBe(true);
  expect(renderer!.root.findByProps({ "aria-label": "資料夾批次 Amazon 站點" }).props.disabled).toBe(true);
  expect(button("選擇資料夾").props.disabled).toBe(true);
  await act(async () => fixture.invalidate());
  await act(async () => { finish(Response.json({ amazonUrl: urls[0], readyForAmazon: true, expiresAt: sourceExpiry })); await preparing; });
  expect(fixture.busy.at(-1)).toBe(false);
  expect(text()).not.toContain("AF_US組圖_AFA12AM_V11");
  expect(fixture.calls.filter(call => call.method === "POST" && call.path === "/api/sp-api/listing-images-batch")).toHaveLength(0);
});

it("allows only a status read after uncertain submission and never offers the same PATCH again", async () => {
  const fixture = await mountSafetyFixture({ uncertainCommit: true });
  await chooseOne();
  await act(async () => { await button("準備圖片並核對 1 個 SKU").props.onClick(); });
  await act(async () => renderer!.root.findByProps({ type: "checkbox" }).props.onChange({ target: { checked: true } }));
  const submit = button("一次指紋確認並更新 1 個 SKU").props.onClick;
  await act(async () => { await submit(); await submit(); });
  expect(fixture.busy.at(-1)).toBe(true);
  expect(button("一次指紋確認並更新 1 個 SKU")).toBeUndefined();
  await act(async () => { await button("重新讀取本批次進度").props.onClick(); });
  expect(fixture.busy.at(-1)).toBe(false);
  expect(text()).toContain("Amazon 已接受");
  expect(fixture.calls.filter(call => call.method === "PATCH")).toHaveLength(1);
});


it("stops a thirty-SKU preparation when an earlier image reaches the ten-minute margin", async () => {
  let count = 0;
  const fixture = await mountSafetyFixture({ upload: async () => {
    count += 1;
    if (count === 30) vi.mocked(Date.now).mockReturnValue(initialNow + 50 * 60_000);
    return Response.json({ amazonUrl: `https://images.example/${count}.jpg`, readyForAmazon: true, expiresAt: new Date(Date.now() + 60 * 60_000).toISOString() });
  } });
  const files = Array.from({length:30}, (_,index) => {
    const sku = `AFA${index + 1}AM`;
    const item = new File(["image"], `${sku}_01.jpg`, {type:"image/jpeg"});
    Object.defineProperty(item,"webkitRelativePath",{value:`family/${sku}/${item.name}`});
    return item;
  });
  await act(async () => renderer!.root.findByProps({"aria-label":"選擇商品資料夾"}).props.onChange({target:{files,value:""}}));
  await act(async () => { await button("準備圖片並核對 30 個 SKU").props.onClick(); });
  expect(count).toBe(30);
  expect(fixture.calls.filter(call => call.method === "POST" && call.path === "/api/sp-api/listing-images-batch")).toHaveLength(0);
  expect(text()).toContain("暫存期限不足十分鐘");
  expect(button("重新準備並核對").props.disabled).toBe(false);
});

it.each([10, 7 * 24 * 60])("refuses a source with %s minutes remaining before review", async minutes => {
  const fixture = await mountSafetyFixture({upload:async()=>Response.json({amazonUrl:urls[0],readyForAmazon:true,expiresAt:new Date(initialNow + minutes * 60_000).toISOString()})});
  await chooseOne();
  await act(async () => { await button("準備圖片並核對 1 個 SKU").props.onClick(); });
  expect(fixture.calls.filter(call => call.method === "POST").map(call=>call.path)).toEqual(["/api/uploads/listing-images"]);
  expect(button("重新準備並核對").props.disabled).toBe(false);
});


it("refuses a review ticket that outlives an earlier source's ten-minute margin", async () => {
  const fixture = await mountSafetyFixture({upload:async()=>Response.json({amazonUrl:urls[0],readyForAmazon:true,expiresAt:new Date(initialNow + 20 * 60_000).toISOString()})});
  await chooseOne();
  await act(async () => { await button("準備圖片並核對 1 個 SKU").props.onClick(); });
  expect(text()).toContain("核對期限已不足");
  expect(button("一次指紋確認並更新 1 個 SKU")).toBeUndefined();
  expect(fixture.calls.filter(call=>call.method === "PATCH")).toHaveLength(0);
});


it("explicitly refreshes Amazon readback with visible waiting feedback instead of only rereading progress", async () => {
  const fixture = await mountSafetyFixture({ uncertainCommit: true });
  await chooseOne();
  await act(async () => { await button("準備圖片並核對 1 個 SKU").props.onClick(); });
  await act(async () => renderer!.root.findByProps({ type: "checkbox" }).props.onChange({ target: { checked: true } }));
  await act(async () => { await button("一次指紋確認並更新 1 個 SKU").props.onClick(); });
  let release!: (response: Response) => void;
  const pending = new Promise<Response>(resolve => { release = resolve; });
  vi.mocked(fetch).mockImplementationOnce(() => pending);
  let refreshing!: Promise<void>;
  await act(async () => { refreshing = button("重新讀取本批次進度").props.onClick(); });
  expect(vi.mocked(fetch).mock.lastCall?.[0]).toContain("&refresh=true");
  expect(text()).toContain("正在唯讀回查 Amazon 圖片");
  expect(button("重新讀取本批次進度").props.disabled).toBe(true);
  await act(async () => {
    release(Response.json({ ...batch, phase: "completed", rows: [{ ...batch.rows[0], state: "verified" }],
      totals: { ...batch.totals, ready: 0, submitted: 1, accepted: 1, verified: 1 }, lastReadbackAt: new Date(initialNow).toISOString() }));
    await refreshing;
  });
  expect(text()).toContain("★ Amazon 回查確認");
  expect(text()).toContain("最近回查：");
  expect(fixture.calls.filter(call => call.method === "PATCH")).toHaveLength(1);
});

it("restores previous exact-SKU progress without selecting files or sending any upload or mutation", async () => {
  const fixture = await mountSafetyFixture();
  await act(async () => renderer!.root.findByProps({ "aria-label": "找回圖片更新的 SKU" }).props.onChange({ target: { value: "AFA12AM" } }));
  vi.mocked(fetch).mockImplementationOnce(async () => Response.json({ ...batch, phase: "completed", rows: [{ ...batch.rows[0], state: "verified", acceptedAt: new Date(initialNow).toISOString() }],
    totals: { ...batch.totals, ready: 0, submitted: 1, accepted: 1, verified: 1 }, lastReadbackAt: new Date(initialNow).toISOString() }));
  await act(async () => { await button("讀取先前圖片進度").props.onClick(); });
  const requestUrl = new URL(String(vi.mocked(fetch).mock.lastCall?.[0]), "https://example.test");
  expect(JSON.parse(requestUrl.searchParams.get("recoverSkus")!)).toEqual(["AFA12AM"]);
  expect(renderer!.root.findByProps({ "aria-label": "先前圖片更新進度" })).toBeTruthy();
  expect(text()).toContain("AFA12AM");
  expect(text()).toContain("★ Amazon 回查確認");
  expect(text()).toContain("2 張");
  expect(button("一次指紋確認並更新 1 個 SKU")).toBeUndefined();
  expect(fixture.calls.every(call => call.method === "GET")).toBe(true);
  expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
});

it("does not represent a legacy local-only progress button as fresh Amazon recovery", async () => {
  await mountSafetyFixture();
  // Re-render under a different marketplace forces the capability check again.
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ capability: "listing-image-batch-v1", maxSkus: 30, maxImagesPerSku: 10, replacementMode: "complete", confirmationMode: "native" }));
  await act(async () => renderer!.update(<ImageFolderWorkspace marketplaceId="A1F83G8C2ARO7P" onBusyChange={() => undefined} />));
  await act(async () => renderer!.root.findByProps({ "aria-label": "找回圖片更新的 SKU" }).props.onChange({ target: { value: "AFA12AM" } }));
  const calls = vi.mocked(fetch).mock.calls.length;
  await act(async () => { await button("讀取先前圖片進度").props.onClick(); });
  expect(text()).toContain("請更新 Notebook Key");
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(calls);
});


it("preserves commas inside an exact recovery SKU and rejects surrounding whitespace before any request", async () => {
  await mountSafetyFixture();
  const input = renderer!.root.findByProps({ "aria-label": "找回圖片更新的 SKU" });
  await act(async () => input.props.onChange({ target: { value: " AFA12AM" } }));
  const before = vi.mocked(fetch).mock.calls.length;
  await act(async () => { await button("讀取先前圖片進度").props.onClick(); });
  expect(text()).toContain("SKU 前後不可有空白");
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(before);
  await act(async () => input.props.onChange({ target: { value: "AFA12AM,PACK\r\n\r\n" } }));
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ...batch, phase: "completed", rows: [{ ...batch.rows[0], sellerSku: "AFA12AM,PACK", state: "accepted" }] }));
  await act(async () => { await button("讀取先前圖片進度").props.onClick(); });
  const requestUrl = new URL(String(vi.mocked(fetch).mock.lastCall?.[0]), "https://example.test");
  expect(JSON.parse(requestUrl.searchParams.get("recoverSkus")!)).toEqual(["AFA12AM,PACK"]);
});

it.each([false, true])("allows a manual progress read after an active observer disconnects (legacy: %s)", async legacyReadback => {
  await mountSafetyFixture({ legacyReadback });
  await chooseOne();
  await act(async () => { await button("準備圖片並核對 1 個 SKU").props.onClick(); });
  await act(async () => renderer!.root.findByProps({ type: "checkbox" }).props.onChange({ target: { checked: true } }));
  const callbacks: Array<() => void> = [];
  vi.spyOn(window, "setTimeout").mockImplementation(callback => { callbacks.push(callback as () => void); return 1; });
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ...batch, phase: "readback", rows: [{ ...batch.rows[0], state: "accepted" }] }));
  await act(async () => { await button("一次指紋確認並更新 1 個 SKU").props.onClick(); });
  expect(button("重新讀取本批次進度").props.disabled).toBe(true);
  vi.mocked(fetch).mockRejectedValueOnce(new Error("Read unavailable"));
  await act(async () => { callbacks.at(-1)!(); await Promise.resolve(); });
  expect(text()).toContain("Read unavailable");
  expect(button("重新讀取本批次進度").props.disabled).toBe(false);
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ...batch, phase: "completed", rows: [{ ...batch.rows[0], state: "verified" }] }));
  await act(async () => { await button("重新讀取本批次進度").props.onClick(); });
  expect(String(vi.mocked(fetch).mock.lastCall?.[0]).includes("&refresh=true")).toBe(!legacyReadback);
  expect(text()).toContain("★ Amazon 回查確認");
  expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1);
});

const diagnosticFixture = {
  version: 1, decision: "pending", blockers: ["error-issues"],
  issues: { errorCount: 2, imageErrorCount: 0, nonImageErrorCount: 2, unscopedErrorCount: 0 },
  slots: { compared: true, targetCount: 10, matchedCount: 10, missingCount: 0, deletionPendingCount: 0,
    differentUrlCount: 0, invalidUrlCount: 0, unchangedPreviousCount: 0, amazonHostedDifferentCount: 0, crossHostAmazonDifferentCount: 0 },
};
function pendingRecovery(readbackDiagnostics?: unknown) {
  return { ...batch, phase: "completed", rows: [{ ...batch.rows[0], state: "accepted", acceptedAt: new Date(initialNow).toISOString(),
    message: "已讀取 Amazon，尚未符合回查確認條件；請查看本次回查原因，勿重送。", ...(readbackDiagnostics === undefined ? {} : { readbackDiagnostics }) }],
    totals: { ...batch.totals, ready: 0, submitted: 1, accepted: 1, verified: 0 }, lastReadbackAt: new Date(initialNow).toISOString() };
}
async function recoverWithDiagnostics(diagnostics?: unknown) {
  await mountSafetyFixture();
  await act(async () => renderer!.root.findByProps({ "aria-label": "找回圖片更新的 SKU" }).props.onChange({ target: { value: "AFA12AM" } }));
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(pendingRecovery(diagnostics)));
  await act(async () => { await button("讀取先前圖片進度").props.onClick(); });
}

it("explains a non-image Amazon error without presenting an exact image match as completed", async () => {
  await recoverWithDiagnostics(diagnosticFixture);
  expect(renderer!.root.findByProps({ "aria-label": "AFA12AM 本次回查原因" })).toBeTruthy();
  expect(text()).toContain("圖片位置符合 10／10");
  expect(text()).toContain("其他欄位錯誤 2 項");
  expect(text()).toContain("Amazon 已接受，待回查");
  expect(text()).not.toContain("★ Amazon 回查確認");
  expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
});

it("shows Amazon-hosted URL differences only as unverified evidence", async () => {
  await recoverWithDiagnostics({ ...diagnosticFixture, blockers: ["url-mismatch"],
    issues: { errorCount: 0, imageErrorCount: 0, nonImageErrorCount: 0, unscopedErrorCount: 0 },
    slots: { ...diagnosticFixture.slots, matchedCount: 1, differentUrlCount: 9, amazonHostedDifferentCount: 9, crossHostAmazonDifferentCount: 9 } });
  expect(text()).toContain("圖片位置符合 1／10");
  expect(text()).toContain("圖片網址不同 9 個位置");
  expect(text()).toContain("有 9 個位置回傳為不同來源的 Amazon 圖片網址");
  expect(text()).toContain("尚不能據此確認為本次送出的圖片");
  expect(text()).not.toContain("★ Amazon 回查確認");
  expect(button("一次指紋確認並更新 1 個 SKU")).toBeUndefined();
});

it.each([
  { ...diagnosticFixture, upstream: "PRIVATE_DIAGNOSTIC_CANARY" },
  { ...diagnosticFixture, blockers: ["PRIVATE_DIAGNOSTIC_CANARY"] },
  { ...diagnosticFixture, slots: { ...diagnosticFixture.slots, matchedCount: 11 } },
])("rejects malformed diagnostic fields before displaying the recovered result", async diagnostics => {
  await recoverWithDiagnostics(diagnostics);
  expect(text()).toContain("批次回應與本次商品不一致");
  expect(text()).not.toContain("PRIVATE_DIAGNOSTIC_CANARY");
  expect(renderer!.root.findAllByProps({ "aria-label": "AFA12AM 本次回查原因" })).toHaveLength(0);
  expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
});

it("hides previous diagnostics during a fresh read and after a disconnected observer", async () => {
  await recoverWithDiagnostics(diagnosticFixture);
  let reject!: (reason: Error) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  let refresh!: Promise<void>;
  await act(async () => { refresh = button("重新讀取本批次進度").props.onClick(); });
  expect(renderer!.root.findAllByProps({ "aria-label": "AFA12AM 本次回查原因" })).toHaveLength(0);
  await act(async () => { reject(new Error("Read disconnected")); await refresh; });
  expect(text()).toContain("Read disconnected");
  expect(renderer!.root.findAllByProps({ "aria-label": "AFA12AM 本次回查原因" })).toHaveLength(0);
  expect(button("重新讀取本批次進度").props.disabled).toBe(false);
});

it("does not invent zero errors or image comparisons for a legacy pending response", async () => {
  await recoverWithDiagnostics();
  expect(text()).toContain("Amazon 已接受，待回查");
  expect(renderer!.root.findAllByProps({ "aria-label": "AFA12AM 本次回查原因" })).toHaveLength(0);
  expect(text()).not.toContain("圖片位置符合");
});

it("keeps the row pending when canonical values match but the operation record is not confirmed", async () => {
  await recoverWithDiagnostics({ ...diagnosticFixture, decision: "verified", blockers: [],
    issues: { errorCount: 0, imageErrorCount: 0, nonImageErrorCount: 0, unscopedErrorCount: 0 } });
  expect(text()).toContain("本次圖片資料已相符，更新紀錄仍待確認");
  expect(text()).toContain("Amazon 已接受，待回查");
  expect(text()).not.toContain("★ Amazon 回查確認");
});

it("does not redisplay previous reasons after a failed recovery request", async () => {
  await recoverWithDiagnostics(diagnosticFixture);
  vi.mocked(fetch).mockRejectedValueOnce(new Error("Recovery disconnected"));
  await act(async () => { await button("讀取先前圖片進度").props.onClick(); });
  expect(text()).toContain("Recovery disconnected");
  expect(text()).toContain("AFA12AM");
  expect(renderer!.root.findAllByProps({ "aria-label": "AFA12AM 本次回查原因" })).toHaveLength(0);
  vi.mocked(fetch).mockResolvedValueOnce(Response.json(pendingRecovery(diagnosticFixture)));
  await act(async () => { await button("讀取先前圖片進度").props.onClick(); });
  expect(renderer!.root.findByProps({ "aria-label": "AFA12AM 本次回查原因" })).toBeTruthy();
  expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
});
