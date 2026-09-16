import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";

const delayedWorkspaceLoads = vi.hoisted(() => vi.fn());
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    lazy: (() => {
      // Pages replaces hashed assets on publication. An already-open console
      // cannot download its old price-list chunk after that replacement.
      return actual.lazy(() => {
        delayedWorkspaceLoads();
        return Promise.reject(new TypeError("Failed to fetch dynamically imported module: https://example.invalid/workspace-old.js"));
      });
    }) as typeof actual.lazy,
  };
});

import Dashboard from "../src/renderer/src/components/dashboard";

let renderer: ReactTestRenderer | null = null;
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
});

it("opens and reopens the real price list after publication without needing an old lazy chunk or starting Amazon reads", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const fetch = vi.fn((_path: string) => new Promise<Response>(() => undefined));
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("window", {
    fbaOS: { app: { version: vi.fn(async () => "0.1.79"), onContextInvalidated: vi.fn(() => vi.fn()) } },
    scrollY: 0,
    location: { hash: "" },
    localStorage: { getItem: vi.fn(() => null), setItem: vi.fn() },
    setTimeout: vi.fn(() => 1), clearTimeout: vi.fn(),
    setInterval: vi.fn(() => 1), clearInterval: vi.fn(),
    requestAnimationFrame: vi.fn(() => 1), cancelAnimationFrame: vi.fn(), scrollTo: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  });
  vi.stubGlobal("document", {
    documentElement: { style: { scrollBehavior: "smooth" }, setAttribute: vi.fn() },
    visibilityState: "visible", querySelector: vi.fn(() => null), getElementById: vi.fn(() => null),
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  });
  await act(async () => {
    renderer = create(createElement(Dashboard), {
      createNodeMock: () => ({ focus: vi.fn(), contains: () => false, querySelectorAll: () => [], getBoundingClientRect: () => ({ width: 760 }) }),
    });
  });
  const open = async () => {
    await act(async () => renderer!.root.findByProps({ "aria-label": "價格區" }).props.onClick());
    const menuitem = renderer!.root.findAllByProps({ role: "menuitem" }).find((item) => item.findByType("strong").children.join("") === "價目表")!;
    await act(async () => menuitem.props.onClick());
    await act(async () => { await vi.dynamicImportSettled(); });
  };
  await open();
  expect(renderer!.root.findAllByProps({ className: "deferred-workspace-status", role: "alert" })).toHaveLength(0);
  const workspace = renderer!.root.findByProps({ className: "price-list-workspace" });
  expect(workspace.findByProps({ "aria-label": "選取原始價目表" })).toBeDefined();
  expect(workspace.findAllByType("button").some((button) => button.children.includes("產生 Amazon 價目表"))).toBe(true);
  await act(async () => workspace.findAllByType("button").find((button) => button.children.includes("← 返回首頁"))!.props.onClick());
  await open();
  expect(renderer!.root.findByProps({ className: "price-list-workspace" })).toBe(workspace);
  expect(delayedWorkspaceLoads).not.toHaveBeenCalled();
  expect(fetch.mock.calls.some(([path]) => path.startsWith("/api/price-list/"))).toBe(false);
});
