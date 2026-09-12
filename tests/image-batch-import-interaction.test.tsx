import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import ImageWorkspaceDrawer from "../src/renderer/src/components/image-workspace-drawer";

const marketplaceId = "ATVPDKIKX0DER";
const sellerSku = "PRODUCT_A-1";
const oldUrls = Array.from({ length: 9 }, (_, index) => `https://images.example/old-${index + 1}.jpg`);
let renderer: ReactTestRenderer | null = null;
const uploadNames: string[] = [];
const mutations: string[] = [];
const output = () => JSON.stringify(renderer?.toJSON());
function button(name: string) {
  return renderer!.root.findAllByType("button").find(node => node.children.join("") === name)!;
}
async function mount(upload?: (file: File) => Promise<Response>) {
  uploadNames.length = 0;
  mutations.length = 0;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn(), confirm: vi.fn(() => true) });
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
        capability: { attributeName: `image${index}`, label: `圖片 ${index + 1}`, supported: true, editable: true, required: index === 0, reason: null } })),
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
  it("maps shuffled 01–09 names to exact slots with a visible replacement review and no Amazon publish", async () => {
    await mount();
    await drop([`${sellerSku}_09_系列底圖_模板.png`, `${sellerSku}_01_主圖.png`, `${sellerSku}_02_賣點.png`]);
    expect(uploadNames).toEqual([]);
    expect(output()).toContain("取代目前圖片");
    await act(async () => { await button("檢查並套用 3 張").props.onClick(); });
    expect(uploadNames).toEqual([`${sellerSku}_09_系列底圖_模板.png`, `${sellerSku}_01_主圖.png`, `${sellerSku}_02_賣點.png`]);
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
    await drop([`${sellerSku}_01_第一張.png`, `${sellerSku}_01_重複.png`, `product_A-1_02_不同大小寫.png`, `${sellerSku}_09_安全.png`, `${sellerSku}_10_超出範圍.png`]);
    expect(output()).toContain("品號與目前 Seller SKU 不一致");
    expect(output()).toContain("同一位置有重複檔案");
    await act(async () => { await button("檢查並套用 1 張").props.onClick(); });
    expect(uploadNames).toEqual([`${sellerSku}_09_安全.png`]);
    await act(async () => { renderer!.root.findByProps({ "aria-label": `略過：${sellerSku}_01_重複.png` }).props.onClick(); });
    await act(async () => { await button("檢查並套用 1 張").props.onClick(); });
    expect(uploadNames).toEqual([`${sellerSku}_09_安全.png`, `${sellerSku}_01_第一張.png`]);
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

  it("does not bypass product validation by dropping a numbered image on one slot", async () => {
    await mount();
    const slot = renderer!.root.findAll(node => node.type === "article" && String(node.props.className).startsWith("image-slot "))[0];
    await act(async () => { slot.props.onDrop({ preventDefault() {}, dataTransfer: { files: [new File(["fixture"], "WRONG_PRODUCT_01_主圖.png", { type: "image/png" })] } }); });
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

});
