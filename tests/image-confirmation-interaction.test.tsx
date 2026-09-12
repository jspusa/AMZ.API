import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import ImageWorkspaceDrawer from "../src/renderer/src/components/image-workspace-drawer";

const marketplaceId = "ATVPDKIKX0DER";
const sellerSku = "IMAGE-CONFIRM-1";
const asin = "B000000001";
const snapshotToken = "image-snapshot.11111111-1111-4111-8111-111111111111";
const oldUrls = ["https://images.example/main.jpg", "https://images.example/side.jpg", ...Array.from({ length: 8 }, () => null)];
let renderer: ReactTestRenderer | null = null;
let invalidateContext = () => undefined;
const requests: Array<{ method: string; body: Record<string, unknown> }> = [];
const text = () => JSON.stringify(renderer?.toJSON());
const button = (label: string) => renderer!.root.findAllByType("button").find(node => node.children.join("") === label)!;

async function mount(confirmationMode: "native" | null = "native", commitResponse?: () => Promise<Response>, token: string | null = snapshotToken) {
  requests.length = 0;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", {
    addEventListener: vi.fn(), removeEventListener: vi.fn(), confirm: vi.fn(() => true), setTimeout, clearTimeout,
    fbaOS: { app: { onContextInvalidated: (listener: () => void) => {
      invalidateContext = listener;
      return () => { invalidateContext = () => undefined; };
    } } },
  });
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST" || init?.method === "PATCH") {
      requests.push({ method: init.method, body: JSON.parse(String(init.body)) });
      if (init.method === "PATCH" && commitResponse) return commitResponse();
      return Response.json({ mode: "live", status: init.method === "POST" ? "VALID" : "ACCEPTED",
        changedSlots: [0, 1], issues: [], completedAt: "2026-09-12T12:00:00Z", notice: "Amazon 已接受" });
    }
    return Response.json({ ...(confirmationMode ? { confirmationMode } : {}), ...(token ? { snapshotToken: token } : {}), mode: "live", marketplaceId, sellerSku, asin,
      productType: "PET_FOOD", title: "Fixture image product", notice: "",
      images: oldUrls.map((url, index) => ({ attributeName: `image-${index}`, label: `位置 ${index + 1}`, url,
        capability: { attributeName: `image-${index}`, label: `位置 ${index + 1}`, supported: true, editable: true, required: index === 0, reason: null } })),
    });
  }));
  await act(async () => { renderer = create(<ImageWorkspaceDrawer initialMarketplaceId={marketplaceId} initialSellerSku={sellerSku} presentation="workspace" onClose={() => undefined} />); });
}

async function reorder() {
  const slots = renderer!.root.findByProps({ "aria-label": "商品圖片排序" }).findAllByType("article");
  await act(async () => { slots[1].findAllByType("button").find(node => node.children.join("") === "設主圖")!.props.onClick({ stopPropagation() {} }); });
}

afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = null;
  vi.unstubAllGlobals();
});

describe("image final confirmation", () => {
  it("requires a Notebook Key update before preview when the installed image protocol still requires typed SKU", async () => {
    await mount(null);
    await reorder();
    expect(text()).toContain("請更新 AMZ.API Notebook Key");
    expect(button("安全預檢圖片").props.disabled).toBe(true);
    await act(async () => { await button("安全預檢圖片").props.onClick(); });
    expect(requests).toEqual([]);
    expect(renderer!.root.findAllByProps({ className: "image-confirmation" })).toHaveLength(0);
  });

  it("also gates a native-capable Notebook Key that cannot bind the displayed image identity", async () => {
    await mount("native", undefined, null);
    await reorder();
    expect(text()).toContain("請更新 AMZ.API Notebook Key");
    expect(button("安全預檢圖片").props.disabled).toBe(true);
    await act(async () => { await button("安全預檢圖片").props.onClick(); });
    expect(requests).toEqual([]);
  });

  it("shows exact SKU, ASIN and changed positions and submits without a typed-SKU field", async () => {
    await mount();
    await reorder();
    await act(async () => { await button("安全預檢圖片").props.onClick(); });
    const confirmation = renderer!.root.findByProps({ className: "image-confirmation" });
    expect(confirmation.findAllByType("input")).toHaveLength(0);
    expect(text()).toContain(sellerSku);
    expect(text()).toContain(asin);
    expect(text()).toContain("US · 美國站");
    expect(text()).toContain("變更位置：");
    expect(text()).toContain("1、2");
    expect(text()).toContain("Touch ID／Windows Hello");
    expect(button("送出圖片更新").props.disabled).toBe(false);
    await act(async () => { await button("送出圖片更新").props.onClick(); });
    expect(requests.map(request => request.method)).toEqual(["POST", "PATCH"]);
    for (const request of requests) {
      expect(request.body).not.toHaveProperty("confirmationSku");
      expect(request.body).toMatchObject({ marketplaceId, sellerSku, snapshotToken, expectedUrls: oldUrls,
        urls: [oldUrls[1], oldUrls[0], ...Array.from({ length: 8 }, () => null)] });
    }
    expect(requests[1].body.idempotencyKey).toBe(requests[0].body.idempotencyKey);
    expect(text()).toContain("Amazon 已接受，正在下載與審核");
  });

  it("clears a preview after security context invalidation without submitting its old image proposal", async () => {
    await mount();
    await reorder();
    await act(async () => { await button("安全預檢圖片").props.onClick(); });
    expect(button("送出圖片更新").props.disabled).toBe(false);
    await act(async () => { invalidateContext(); });
    expect(renderer!.root.findAllByProps({ className: "image-confirmation" })).toHaveLength(0);
    expect(text()).toContain("帳號或安全環境已更新");
    expect(requests.map(request => request.method)).toEqual(["POST"]);
  });

  it("locks the final confirmation while one submission is awaiting native approval and completion", async () => {
    let finish!: (response: Response) => void;
    await mount("native", () => new Promise(resolve => { finish = resolve; }));
    await reorder();
    await act(async () => { await button("安全預檢圖片").props.onClick(); });
    let submitting!: Promise<void>;
    await act(async () => { submitting = button("送出圖片更新").props.onClick(); });
    expect(button("送出中…").props.disabled).toBe(true);
    expect(button("← 返回排序").props.disabled).toBe(true);
    await act(async () => { await button("送出中…").props.onClick(); });
    expect(requests.map(request => request.method)).toEqual(["POST", "PATCH"]);
    await act(async () => {
      finish(Response.json({ mode: "live", status: "ACCEPTED", changedSlots: [0, 1], issues: [], notice: "Amazon 已接受" }));
      await submitting;
    });
    expect(text()).toContain("Amazon 已接受，正在下載與審核");
  });
});
