import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import ImageWorkspaceDrawer from "../src/renderer/src/components/image-workspace-drawer";

const marketplaceId = "ATVPDKIKX0DER";
const sellerSku = "PRODUCT_A-1";
const oldUrls = Array.from({ length: 10 }, (_, index) => `https://images.example/old-${index + 1}.jpg`);
let renderer: ReactTestRenderer | null = null;
const uploadNames: string[] = [];
const mutations: string[] = [];
let invalidateContext = () => undefined;
const output = () => JSON.stringify(renderer?.toJSON());
function button(name: string) {
  return renderer!.root.findAllByType("button").find(node => node.children.join("") === name)!;
}
async function mount(upload?: (file: File) => Promise<Response>, unavailableSlots: number[] = []) {
  uploadNames.length = 0;
  mutations.length = 0;
  invalidateContext = () => undefined;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn(), confirm: vi.fn(() => true), setTimeout, clearTimeout, fbaOS: { app: { onContextInvalidated: (listener: () => void) => { invalidateContext = listener; return () => { invalidateContext = () => undefined; }; } } } });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/uploads/listing-images") {
      const form = init!.body as FormData;
      expect(form.get("sellerSku")).toBe(sellerSku);
      expect(form.get("marketplaceId")).toBe(marketplaceId);
      const file = form.get("file") as File;
      uploadNames.push(file.name);
      return upload ? upload(file) : Response.json({ key: file.name, previewUrl: `https://images.example/${file.name}`, amazonUrl: `https://images.example/${file.name}`, readyForAmazon: true });
    }
    if (init?.method === "POST" || init?.method === "PATCH") {
      mutations.push(init.method);
      return Response.json({ mode: "live", status: "VALID", changedSlots: [0, 1, 8], issues: [] });
    }
    return Response.json({
      mode: "live", marketplaceId, sellerSku, asin: "B000000001", productType: "PET_FOOD", title: "Fixture product", notice: "",
      images: oldUrls.map((url, index) => ({ attributeName: `image${index}`, label: index ? `副圖 ${index}` : "主圖", url,
        capability: { attributeName: `image${index}`, label: `圖片 ${index + 1}`, supported: !unavailableSlots.includes(index), editable: !unavailableSlots.includes(index), required: index === 0, reason: unavailableSlots.includes(index) ? `Amazon 商品規格未提供第 ${index + 1} 張` : null } })),
    });
  }));
  await act(async () => { renderer = create(<ImageWorkspaceDrawer initialMarketplaceId={marketplaceId} initialSellerSku={sellerSku} presentation="workspace" onClose={() => undefined} />); });
}
async function drop(names: string[]) {
  await act(async () => { renderer!.root.findByProps({ className: "image-drop-zone" }).props.onDrop({
    preventDefault: () => undefined, dataTransfer: { files: names.map(name => new File(["fixture"], name, { type: "image/png" })) },
  }); });
}
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = null; vi.unstubAllGlobals(); });

describe("image batch import through the image workspace", () => {
  it("sorts numeric filenames with optional descriptions while keeping invalid names out of preparation", async () => {
    await mount();
    const accepted = [`${sellerSku}_01.png`, `${sellerSku}_02.png`, `${sellerSku}_03_說明.png`, `${sellerSku}_10.png`];
    const rejected = ["WRONG_PRODUCT_04.png", `${sellerSku}_04_非法/路徑.png`];
    await drop([accepted[3], accepted[1], ...rejected, accepted[2], accepted[0]]);
    expect(renderer!.root.findAllByType("select").filter(node => String(node.props["aria-label"]).startsWith("圖片位置：")).slice(0, 4).map(node => node.props["aria-label"]))
      .toEqual(accepted.map(name => `圖片位置：${name}`));
    expect(button("檢查並套用 4 張").props.disabled).toBe(false);
    for (const name of rejected) expect(renderer!.root.findByProps({ "aria-label": `圖片位置：${name}` }).props.disabled).toBe(true);
    await act(async () => { await button("檢查並套用 4 張").props.onClick(); });
    expect(uploadNames).toEqual(accepted);
    expect(mutations).toEqual([]);
  });

  it.each(["between files", "late response"])("quarantines files when security context changes %s and requires a fresh lookup", async timing => {
    let finish!: (response: Response) => void;
    const pending = new Promise<Response>(resolve => { finish = resolve; });
    let first = true;
    await mount(async file => {
      if (first) {
        first = false;
        if (timing === "late response") return pending;
        const response = Response.json({ previewUrl: "https://images.example/stale.jpg", amazonUrl: "https://images.example/stale.jpg", readyForAmazon: true });
        const read = response.json.bind(response);
        response.json = async () => {
          const payload = await read();
          queueMicrotask(() => queueMicrotask(() => invalidateContext()));
          return payload;
        };
        return response;
      }
      return Response.json({ previewUrl: `https://images.example/${file.name}`, amazonUrl: `https://images.example/${file.name}`, readyForAmazon: true });
    });
    const names = [`${sellerSku}_01_主圖.png`, `${sellerSku}_02_賣點.png`];
    await drop(names);
    let applying!: Promise<void>;
    await act(async () => { applying = button("檢查並套用 2 張").props.onClick(); });
    if (timing === "late response") {
      await act(async () => { invalidateContext(); });
      await act(async () => { finish(Response.json({ previewUrl: "https://images.example/stale.jpg", amazonUrl: "https://images.example/stale.jpg", readyForAmazon: true })); await applying; });
    } else await act(async () => { await applying; });
    expect(uploadNames).toEqual([names[0]]);
    expect(output()).not.toContain("https://images.example/stale.jpg");
    expect(renderer!.root.findAllByProps({ className: "image-drop-zone" })).toHaveLength(0);
    expect(button("重新準備保留圖片").props.disabled).toBe(true);
    await act(async () => { await renderer!.root.findByProps({ className: "price-search image-search" }).props.onSubmit({ preventDefault() {} }); });
    expect(uploadNames).toHaveLength(1);
    await act(async () => { button("重新準備保留圖片").props.onClick(); });
    expect(uploadNames).toHaveLength(1);
    expect(button("檢查並套用 2 張").props.disabled).toBe(false);
    await act(async () => { await button("檢查並套用 2 張").props.onClick(); });
    expect(uploadNames).toEqual([names[0], ...names]);
    expect(mutations).toEqual([]);
  });

  it("reopens a staged original file at its corrected position and shows preparation completion", async () => {
    let hostingReady = false;
    await mount(async file => Response.json({ key: file.name, previewUrl: "data:image/png;base64,ZmFrZQ==", amazonUrl: hostingReady ? "https://images.example/seven.jpg" : null, readyForAmazon: hostingReady }));
    const name = `${sellerSku}_07_成分GA_模板.png`;
    await drop([name]);
    await act(async () => { await button("檢查並套用 1 張").props.onClick(); });
    const slot = renderer!.root.findAll(node => node.type === "article" && String(node.props.className).startsWith("image-slot "))[6];
    await act(async () => { slot.findAllByType("button").find(node => node.children.join("") === "→")!.props.onClick({ stopPropagation() {} }); });
    await act(async () => { button("收起對照").props.onClick(); });
    expect(renderer!.root.findAllByProps({ "aria-label": "批次圖片對照" })).toHaveLength(0);
    await act(async () => { button("繼續準備暫存圖片").props.onClick(); });
    expect(renderer!.root.findByProps({ "aria-label": `圖片位置：${name}` }).props.value).toBe(7);
    await act(async () => { renderer!.root.findByProps({ "aria-label": `查看位置：${name}` }).props.onClick(); });
    expect(renderer!.root.findByProps({ className: "image-url-panel" }).findByType("strong").children.join("")).toContain("副圖 7");
    hostingReady = true;
    await act(async () => { await button("檢查並套用 1 張").props.onClick(); });
    expect(uploadNames).toEqual([name, name]);
    const slots = renderer!.root.findAll(node => node.type === "article" && String(node.props.className).startsWith("image-slot "));
    expect(slots[7].findByType("img").props.src).toContain("data:image");
    expect(slots[6].findByType("img").props.src).toBe(oldUrls[7]);
    expect(renderer!.root.findByProps({ className: "image-batch-footer" }).findByProps({ role: "status" }).children.join("")).toContain("草稿就緒 1 張");
    expect(output()).not.toContain("檢查並套用 0 張");
    expect(button("安全預檢圖片").props.disabled).toBe(false);
    expect(mutations).toEqual([]);
  });

  it("keeps a prepared row aligned when its draft moves and a manual URL makes it ready", async () => {
    await mount(async file => Response.json({ key: file.name, previewUrl: "data:image/png;base64,ZmFrZQ==", amazonUrl: null, readyForAmazon: false }));
    vi.stubGlobal("Image", class {
      naturalWidth = 1000; naturalHeight = 1000; onload?: () => void;
      set src(value: string) { if (value) queueMicrotask(() => this.onload?.()); }
    });
    const name = `${sellerSku}_07_成分GA_模板.png`;
    await drop([name]);
    await act(async () => { await button("檢查並套用 1 張").props.onClick(); });
    const slot = renderer!.root.findAll(node => node.type === "article" && String(node.props.className).startsWith("image-slot "))[6];
    await act(async () => { slot.findAllByType("button").find(node => node.children.join("") === "→")!.props.onClick({ stopPropagation() {} }); });
    expect(renderer!.root.findByProps({ "aria-label": `圖片位置：${name}` }).props.value).toBe(7);
    await act(async () => { renderer!.root.findByProps({ className: "image-url-panel" }).findByType("input").props.onChange({ target: { value: "https://images.example/manual-ready.jpg" } }); });
    await act(async () => { await button("檢查並套用").props.onClick(); });
    expect(output()).not.toContain("原檔已保留，待準備圖片");
    expect(output()).toContain("已套用至草稿");
    expect(button("安全預檢圖片").props.disabled).toBe(false);
    expect(uploadNames).toEqual([name]);
    expect(mutations).toEqual([]);
  });

  it("keeps the original file available to prepare a private image again and focuses its exact slot", async () => {
    let hostingReady = false;
    await mount(async file => {
      expect(await file.text()).toBe("fixture");
      return Response.json({ key: file.name, previewUrl: "data:image/png;base64,ZmFrZQ==", amazonUrl: hostingReady ? "https://images.example/ready-seven.jpg" : null, readyForAmazon: hostingReady });
    });
    const slots = () => renderer!.root.findAll(node => node.type === "article" && String(node.props.className).startsWith("image-slot "));
    await act(async () => { slots()[7].props.onClick(); });
    await drop([`${sellerSku}_07_成分GA_模板.png`]);
    await act(async () => { await button("檢查並套用 1 張").props.onClick(); });
    expect(renderer!.root.findByProps({ className: "image-url-panel" }).findByType("strong").children.join("")).toContain("副圖 6");
    expect(output()).toContain("原檔已保留，待準備圖片");
    expect(button("檢查並套用 1 張").props.disabled).toBe(false);
    expect(button("安全預檢圖片").props.disabled).toBe(true);
    hostingReady = true;
    await act(async () => { await button("檢查並套用 1 張").props.onClick(); });
    expect(uploadNames).toEqual([`${sellerSku}_07_成分GA_模板.png`, `${sellerSku}_07_成分GA_模板.png`]);
    expect(slots()[6].findByType("img").props.src).toBe("data:image/png;base64,ZmFrZQ==");
    expect(output()).not.toContain("原檔已保留，待準備圖片");
    expect(button("安全預檢圖片").props.disabled).toBe(false);
    expect(mutations).toEqual([]);
  });

  it("retains an unsupported tenth image with the exact product restriction while preparing a safe slot", async () => {
    await mount(undefined, [9]);
    await drop([`${sellerSku}_10_保留.png`, `${sellerSku}_09_可用.png`]);
    expect(output()).toContain("Amazon 商品規格未提供第 10 張");
    expect(renderer!.root.findByProps({ "aria-label": `圖片位置：${sellerSku}_10_保留.png` }).props.disabled).toBe(false);
    await act(async () => { await button("檢查並套用 1 張").props.onClick(); });
    expect(uploadNames).toEqual([`${sellerSku}_09_可用.png`]);
    expect(output()).toContain(`${sellerSku}_10_保留.png`);
    expect(mutations).toEqual([]);
  });

  it("orders numbered files numerically through 10 and retains overflow for correction", async () => {
    await mount();
    await drop([`${sellerSku}_10_第十张.png`, `${sellerSku}_02_賣點.png`, `${sellerSku}_01_主圖.png`, `${sellerSku}_11_保留.png`]);
    const selects = renderer!.root.findAllByType("select").filter(node => String(node.props["aria-label"]).startsWith("圖片位置："));
    expect(selects.map(node => node.props["aria-label"])).toEqual([
      `圖片位置：${sellerSku}_01_主圖.png`, `圖片位置：${sellerSku}_02_賣點.png`, `圖片位置：${sellerSku}_10_第十张.png`, `圖片位置：${sellerSku}_11_保留.png`,
    ]);
    expect(output()).toContain("未提供第 11 張");
    expect(selects[3].props.disabled).toBe(false);
    await act(async () => { await button("檢查並套用 3 張").props.onClick(); });
    expect(uploadNames).toEqual([`${sellerSku}_01_主圖.png`, `${sellerSku}_02_賣點.png`, `${sellerSku}_10_第十张.png`]);
    const slots = renderer!.root.findAll(node => node.type === "article" && String(node.props.className).startsWith("image-slot "));
    expect(slots[9].findByType("img").props.src).toContain("_10_");
    expect(output()).toContain(`${sellerSku}_11_保留.png`);
    expect(mutations).toEqual([]);
  });

  it("maps shuffled 01–09 names to exact slots with a visible replacement review and no Amazon publish", async () => {
    await mount();
    await drop([`${sellerSku}_09_系列底圖_模板.png`, `${sellerSku}_01_主圖.png`, `${sellerSku}_02_賣點.png`]);
    expect(uploadNames).toEqual([]);
    expect(output()).toContain("取代目前圖片");
    await act(async () => { await button("檢查並套用 3 張").props.onClick(); });
    expect(uploadNames).toEqual([`${sellerSku}_01_主圖.png`, `${sellerSku}_02_賣點.png`, `${sellerSku}_09_系列底圖_模板.png`]);
    const slots = renderer!.root.findAll(node => node.type === "article" && String(node.props.className).startsWith("image-slot "));
    expect(slots[0].findByType("img").props.src).toContain("_01_主圖.png");
    expect(slots[1].findByType("img").props.src).toContain("_02_賣點.png");
    expect(slots[8].findByType("img").props.src).toContain("_09_系列底圖_模板.png");
    expect(slots[2].findByType("img").props.src).toBe(oldUrls[2]);
    expect(mutations).toEqual([]);
    expect(output()).toContain("已套用至草稿");
  });
  it("isolates wrong products and duplicate slots while allowing safe images and an explicit duplicate correction", async () => {
    await mount();
    await drop([`${sellerSku}_01_第一張.png`, `${sellerSku}_01_重複.png`, `product_A-1_02_不同大小寫.png`, `${sellerSku}_09_安全.png`, `${sellerSku}_11_超出範圍.png`]);
    expect(output()).toContain("品號與目前 Seller SKU 不一致");
    expect(output()).toContain("同一位置有重複檔案");
    await act(async () => { await button("檢查並套用 1 張").props.onClick(); });
    expect(uploadNames).toEqual([`${sellerSku}_09_安全.png`]);
    await act(async () => { renderer!.root.findByProps({ "aria-label": `略過：${sellerSku}_01_重複.png` }).props.onClick(); });
    await act(async () => { await button("檢查並套用 1 張").props.onClick(); });
    expect(uploadNames).toEqual([`${sellerSku}_09_安全.png`, `${sellerSku}_01_第一張.png`]);
    expect(mutations).toEqual([]);
  });

  it("retains an interrupted batch for explicit preparation without re-uploading ready files", async () => {
    let serviceReady = false;
    await mount(async file => {
      if (!serviceReady && file.name.includes("_02_")) return Response.json({ message: "圖片服务尚未登入" }, { status: 503 });
      return Response.json({ previewUrl: `https://images.example/${file.name}`, amazonUrl: `https://images.example/${file.name}`, readyForAmazon: true });
    });
    const names = [1, 2, 3].map(order => `${sellerSku}_0${order}_圖片.png`);
    await drop(names);
    await act(async () => { await button("檢查並套用 3 張").props.onClick(); });
    expect(uploadNames).toEqual(names.slice(0, 2));
    expect(output()).toContain("本批次已停止");
    serviceReady = true;
    await act(async () => { button("重新準備未完成圖片").props.onClick(); });
    expect(uploadNames).toHaveLength(2);
    await act(async () => { await button("檢查並套用 2 張").props.onClick(); });
    expect(uploadNames).toEqual([names[0], names[1], names[1], names[2]]);
    expect(button("安全預檢圖片").props.disabled).toBe(false);
    expect(output()).not.toContain("本批次已停止");
    expect(mutations).toEqual([]);
  });

  it("keeps valid images after a file validation error and stops on uncertain transport without retrying", async () => {
    await mount(async file => {
      if (file.name.includes("_02_")) return Response.json({ message: "像素不足 500px", code: "IMAGE_TOO_SMALL" }, { status: 422 });
      if (file.name.includes("_04_")) throw new TypeError("Network failed");
      return Response.json({ key: file.name, previewUrl: `https://images.example/${file.name}`, amazonUrl: `https://images.example/${file.name}`, readyForAmazon: true });
    });
    await drop([`${sellerSku}_01_主圖.png`, `${sellerSku}_02_小圖.png`, `${sellerSku}_03_尺寸.png`, `${sellerSku}_04_中斷.png`, `${sellerSku}_05_未處理.png`]);
    await act(async () => { await button("檢查並套用 5 張").props.onClick(); });
    expect(uploadNames).toEqual([`${sellerSku}_01_主圖.png`, `${sellerSku}_02_小圖.png`, `${sellerSku}_03_尺寸.png`, `${sellerSku}_04_中斷.png`]);
    expect(output()).toContain("像素不足 500px");
    expect(output()).toContain("本批次已停止");
    const slots = renderer!.root.findAll(node => node.type === "article" && String(node.props.className).startsWith("image-slot "));
    expect(slots[0].findByType("img").props.src).toContain("_01_主圖.png");
    expect(slots[2].findByType("img").props.src).toContain("_03_尺寸.png");
    expect(slots[4].findByType("img").props.src).toBe(oldUrls[4]);
    expect(mutations).toEqual([]);
  });

  it.each(["01_主圖", "100_主圖", "01", "100"])("does not bypass product validation by dropping numbered image %s on one slot", async order => {
    await mount();
    const slot = renderer!.root.findAll(node => node.type === "article" && String(node.props.className).startsWith("image-slot "))[0];
    await act(async () => { slot.props.onDrop({ preventDefault() {}, dataTransfer: { files: [new File(["fixture"], `WRONG_PRODUCT_${order}.png`, { type: "image/png" })] } }); });
    expect(uploadNames).toEqual([]);
    expect(output()).toContain("品號與目前 Seller SKU 不一致");
  });

  it("locks SKU changes and Amazon preview while serial image uploads are active", async () => {
    let finish!: (response: Response) => void;
    const first = new Promise<Response>(resolve => { finish = resolve; });
    await mount(async file => file.name.includes("_01_") ? first : Response.json({ previewUrl: `https://images.example/${file.name}`, amazonUrl: `https://images.example/${file.name}`, readyForAmazon: true }));
    await drop([`${sellerSku}_01_主圖.png`, `${sellerSku}_02_賣點.png`]);
    let pending!: Promise<void>;
    await act(async () => { pending = button("檢查並套用 2 張").props.onClick(); });
    expect(uploadNames).toEqual([`${sellerSku}_01_主圖.png`]);
    expect(button("查詢").props.disabled).toBe(true);
    expect(button("安全預檢圖片").props.disabled).toBe(true);
    expect(renderer!.root.findByProps({ id: "image-audit-tab" }).props.disabled).toBe(true);
    await act(async () => { await button("安全預檢圖片").props.onClick(); });
    expect(mutations).toEqual([]);
    await act(async () => { finish(Response.json({ previewUrl: "https://images.example/new-main.jpg", amazonUrl: "https://images.example/new-main.jpg", readyForAmazon: true })); await pending; });
    expect(uploadNames).toHaveLength(2);
    expect(button("安全預檢圖片").props.disabled).toBe(false);
  });

  it("keeps an unnumbered single-file drop available in an explicitly chosen slot", async () => {
    await mount();
    const slot = renderer!.root.findAll(node => node.type === "article" && String(node.props.className).startsWith("image-slot "))[1];
    await act(async () => { slot.props.onDrop({ preventDefault() {}, dataTransfer: { files: [new File(["fixture"], "new-lifestyle.png", { type: "image/png" })] } }); });
    expect(uploadNames).toEqual(["new-lifestyle.png"]);
    expect(mutations).toEqual([]);
  });

  it("uses the number of a bare filename even when dropped onto a different slot", async () => {
    await mount();
    const name = `${sellerSku}_10.png`;
    const first = renderer!.root.findAll(node => node.type === "article" && String(node.props.className).startsWith("image-slot "))[0];
    await act(async () => { first.props.onDrop({ preventDefault() {}, dataTransfer: { files: [new File(["fixture"], name, { type: "image/png" })] } }); });
    expect(uploadNames).toEqual([]);
    expect(renderer!.root.findByProps({ "aria-label": `圖片位置：${name}` }).props.value).toBe(9);
    await act(async () => { await button("檢查並套用 1 張").props.onClick(); });
    const slots = renderer!.root.findAll(node => node.type === "article" && String(node.props.className).startsWith("image-slot "));
    expect(slots[0].findByType("img").props.src).toBe(oldUrls[0]);
    expect(slots[9].findByType("img").props.src).toContain(name);
  });

  it.each(["cancelled login", "network failure"])("retains an unnumbered file at its chosen slot after %s", async failure => {
    let first = true;
    await mount(async file => {
      if (first) {
        first = false;
        if (failure === "network failure") throw new TypeError("Network failed");
        return Response.json({ code: "IMAGE_PREPARATION_INCOMPLETE", message: "圖片準備尚未完成，檔案仍保留在工作台。" }, { status: 503 });
      }
      return Response.json({ previewUrl: `https://images.example/${file.name}`, amazonUrl: `https://images.example/${file.name}`, readyForAmazon: true });
    });
    const slot = renderer!.root.findAll(node => node.type === "article" && String(node.props.className).startsWith("image-slot "))[1];
    await act(async () => { slot.props.onDrop({ preventDefault() {}, dataTransfer: { files: [new File(["fixture"], "photo.png", { type: "image/png" })] } }); });
    expect(uploadNames).toEqual(["photo.png"]);
    expect(renderer!.root.findByProps({ "aria-label": "圖片位置：photo.png" }).props.value).toBe(1);
    expect(button("安全預檢圖片").props.disabled).toBe(true);
    expect(slot.findByType("img").props.src).toBe(oldUrls[1]);
    await act(async () => { await button("檢查並套用 1 張").props.onClick(); });
    expect(uploadNames).toEqual(["photo.png", "photo.png"]);
    expect(slot.findByType("img").props.src).toContain("photo.png");
    expect(mutations).toEqual([]);
  });

  it.each([false, true])("retains the chosen slot across lock and lets a changed capability be corrected (drift=%s)", async drift => {
    let finish!: (response: Response) => void;
    const pending = new Promise<Response>(resolve => { finish = resolve; });
    let first = true;
    const unavailable: number[] = [];
    await mount(async file => {
      if (first) { first = false; return pending; }
      return Response.json({ previewUrl: `https://images.example/${file.name}`, amazonUrl: `https://images.example/${file.name}`, readyForAmazon: true });
    }, unavailable);
    const slot = renderer!.root.findAll(node => node.type === "article" && String(node.props.className).startsWith("image-slot "))[2];
    await act(async () => { slot.props.onDrop({ preventDefault() {}, dataTransfer: { files: [new File(["fixture"], "photo.png", { type: "image/png" })] } }); });
    await act(async () => { invalidateContext(); });
    if (drift) unavailable.push(2);
    await act(async () => { finish(Response.json({ message: "cancelled" }, { status: 503 })); });
    expect(button("重新準備保留圖片").props.disabled).toBe(true);
    await act(async () => { await renderer!.root.findByProps({ className: "price-search image-search" }).props.onSubmit({ preventDefault() {} }); });
    await act(async () => { button("重新準備保留圖片").props.onClick(); });
    expect(uploadNames).toEqual(["photo.png"]);
    expect(renderer!.root.findByProps({ "aria-label": "圖片位置：photo.png" }).props.value).toBe(2);
    if (drift) {
      expect(output()).toContain("Amazon 商品規格未提供第 3 張");
      const select = renderer!.root.findByProps({ "aria-label": "圖片位置：photo.png" });
      expect(select.props.disabled).toBe(false);
      expect(renderer!.root.findByProps({ "aria-label": "略過：photo.png" })).toBeDefined();
      await act(async () => { select.props.onChange({ target: { value: "3" } }); });
    }
    await act(async () => { await button("檢查並套用 1 張").props.onClick(); });
    expect(uploadNames).toEqual(["photo.png", "photo.png"]);
    expect(mutations).toEqual([]);
  });

});
