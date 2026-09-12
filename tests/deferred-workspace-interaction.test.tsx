import { createElement, lazy } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DeferredWorkspace from "../src/renderer/src/components/deferred-workspace";
import VariationPlannerDrawer from "../src/renderer/src/components/variation-planner-drawer";

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("window", new EventTarget());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
});

describe("deferred workspace interaction", () => {
  it("keeps the pending overlay modal and delegates Escape, close and backdrop to the supplied return action", async () => {
    const PendingView = lazy(() => new Promise<{ default: typeof VariationPlannerDrawer }>(() => undefined));
    const onClose = vi.fn();
    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(createElement(DeferredWorkspace, { overlay: true, onClose,
        children: createElement(PendingView, { initialMarketplaceId: "ATVPDKIKX0DER", onClose }),
      }));
    });
    const root = renderer!.root;
    const dialog = root.findByProps({ role: "dialog" });
    expect(String(dialog.props["aria-modal"])).toBe("true");
    expect(root.findByProps({ role: "status" }).findByType("p").children.join("")).toBe("正在載入工作區…");
    const close = root.findByType("button");
    expect(close.props.autoFocus).toBe(true);
    const preventDefault = vi.fn();
    await act(async () => dialog.props.onKeyDown({ key: "Escape", preventDefault }));
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => close.props.onClick());
    expect(onClose).toHaveBeenCalledTimes(2);
    const backdrop = root.findByProps({ role: "presentation" });
    const surface = {};
    await act(async () => backdrop.props.onMouseDown({ target: {}, currentTarget: surface }));
    expect(onClose).toHaveBeenCalledTimes(2);
    await act(async () => backdrop.props.onMouseDown({ target: surface, currentTarget: surface }));
    expect(onClose).toHaveBeenCalledTimes(3);
    await act(async () => renderer!.unmount());
  });

  it("keeps a failed chunk inside the same dismissible modal boundary", async () => {
    // React reports the deliberately rejected view to the host console even
    // when the public error boundary handles it correctly.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let rejectLoad!: (reason: Error) => void;
    const loading = new Promise<{ default: typeof VariationPlannerDrawer }>((_resolve, reject) => {
      rejectLoad = reject;
    });
    const FailedView = lazy(() => loading);
    const onClose = vi.fn();
    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(createElement(DeferredWorkspace, { overlay: true, onClose,
        children: createElement(FailedView, { initialMarketplaceId: "ATVPDKIKX0DER", onClose }),
      }));
    });
    await act(async () => { rejectLoad(new Error("Chunk unavailable")); await loading.catch(() => undefined); });
    const root = renderer!.root;
    expect(root.findByProps({ role: "alert" }).findByType("p").children.join("")).toContain("無法載入此工作區");
    const dialog = root.findByProps({ role: "dialog" });
    expect(String(dialog.props["aria-modal"])).toBe("true");
    expect(root.findByType("button").props.autoFocus).toBe(true);
    await act(async () => dialog.props.onKeyDown({ key: "Escape", preventDefault: vi.fn() }));
    await act(async () => root.findByType("button").props.onClick());
    expect(onClose).toHaveBeenCalledTimes(2);
    await act(async () => renderer!.unmount());
  });

  it("mounts the real variation drawer after loading with its own close autofocus and the same return action", async () => {
    let resolveLoad!: (value: { default: typeof VariationPlannerDrawer }) => void;
    const loading = new Promise<{ default: typeof VariationPlannerDrawer }>((resolve) => { resolveLoad = resolve; });
    const DelayedPlanner = lazy(() => loading);
    const onClose = vi.fn();
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    let renderer: ReactTestRenderer | null = null;
    await act(async () => {
      renderer = create(createElement(DeferredWorkspace, { overlay: true, onClose,
        children: createElement(DelayedPlanner, { initialMarketplaceId: "ATVPDKIKX0DER", onClose }),
      }));
    });
    expect(renderer!.root.findAllByProps({ "aria-label": "關閉變體規劃" })).toHaveLength(0);
    await act(async () => { resolveLoad({ default: VariationPlannerDrawer }); await loading; });
    const root = renderer!.root;
    expect(root.findAllByProps({ "aria-label": "工作區載入" })).toHaveLength(0);
    expect(root.findAllByProps({ role: "dialog" })).toHaveLength(1);
    const close = root.findByProps({ "aria-label": "關閉變體規劃" });
    expect(close.props.autoFocus).toBe(true);
    expect(close.props.disabled).toBe(false);
    await act(async () => close.props.onClick());
    expect(onClose).toHaveBeenCalledOnce();
    const escape = new Event("keydown");
    Object.defineProperty(escape, "key", { value: "Escape" });
    await act(async () => { window.dispatchEvent(escape); });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => renderer!.unmount());
  });
});

it("retries only a failed module in place while preserving the surrounding console state", async () => {
  const { useMemo, useState } = await import("react");
  const { createWorkspaceLoader } = await import("../src/renderer/src/workspace-loader");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const reload = vi.fn();
  Object.assign(window, { location: { reload } });
  const load = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch dynamically imported module: https://example.invalid/workspace.js"))
    .mockResolvedValue({ default: () => createElement("p", { "data-loaded-workspace": true }, "Workspace") });
  const loader = createWorkspaceLoader(load);
  function Console() {
    const [attempt, setAttempt] = useState(0);
    const [draft, setDraft] = useState("keep draft");
    const View = useMemo(() => lazy(loader.load), [attempt]);
    return createElement("section", null,
      createElement("input", { value: draft, onChange: () => setDraft("edited draft") }),
      createElement(DeferredWorkspace, { key: attempt, onClose: vi.fn(), onRetry: () => setAttempt(value => value + 1), children: createElement(View) }));
  }
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(createElement(Console)); });
  await act(async () => renderer.root.findByType("input").props.onChange());
  const retry = renderer.root.findAllByType("button").find(node => node.children.join("") === "重新載入工作區");
  expect(retry).toBeDefined();
  await act(async () => retry!.props.onClick());
  expect(renderer.root.findByProps({ "data-loaded-workspace": true })).toBeTruthy();
  expect(renderer.root.findByType("input").props.value).toBe("edited draft");
  expect(load).toHaveBeenCalledTimes(2);
  expect(reload).not.toHaveBeenCalled();
  await act(async () => renderer.unmount());
});

it("never offers module retry for a render failure after a workspace has mounted", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const retry = vi.fn();
  function BrokenView(): never { throw new Error("render state failure"); }
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(createElement(DeferredWorkspace, { onClose: vi.fn(), onRetry: retry, children: createElement(BrokenView) })); });
  expect(renderer.root.findAllByType("button").map(node => node.children.join(""))).toEqual(["關閉"]);
  expect(JSON.stringify(renderer.toJSON())).not.toContain("確認連線");
  expect(retry).not.toHaveBeenCalled();
  await act(async () => renderer.unmount());
});
