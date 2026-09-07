import { createElement, StrictMode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import App from "../src/renderer/src/App";

vi.mock("../src/renderer/src/connection-panel", () => ({
  default: ({ open }: { open: boolean }) => open
    ? createElement("div", { "data-connection-settings": true }, "本機安全連線設定")
    : null,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
});

it("keeps navigation and connection settings available during a slow initial Sales request", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let settle!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => { settle = resolve; });
  const fetchMock = vi.fn(() => pending);
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("window", {
    fbaOS: { app: { version: async () => "0.1.55" } },
    localStorage: { getItem: () => null },
    setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => undefined,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  });
  vi.stubGlobal("document", {
    visibilityState: "visible", documentElement: { setAttribute: vi.fn() },
    addEventListener: vi.fn(), removeEventListener: vi.fn(), querySelector: () => null,
  });
  let renderer: ReactTestRenderer;
  await act(async () => {
    renderer = create(createElement(StrictMode, null, createElement(App)));
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  try {
    expect(renderer!.root.findAllByType("nav").length).toBeGreaterThan(0);
    const connection = renderer!.root.find((node) => node.type === "button" && String(node.props["aria-label"]).endsWith("開啟本機安全連線設定"));
    await act(async () => connection.props.onClick());
    expect(renderer!.root.findByProps({ "data-connection-settings": true })).toBeTruthy();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    const skuInput = renderer!.root.findByProps({ "aria-label": "全域 Seller SKU" });
    await act(async () => skuInput.props.onChange({ target: { value: "KEEP-MY-SKU" } }));
    await act(async () => settle(new Response(JSON.stringify({ message: "Sales 暫時無法同步" }), { status: 503 })));
    expect(renderer!.root.findByProps({ "aria-label": "全域 Seller SKU" }).props.value).toBe("KEEP-MY-SKU");
    expect(renderer!.root.findByProps({ "data-connection-settings": true })).toBeTruthy();
    const salesRequests = fetchMock.mock.calls.filter(([url]) => String(url).includes("/sales-trend?"));
    expect(salesRequests).toHaveLength(1);
  } finally {
    await act(async () => renderer!.unmount());
  }
});
