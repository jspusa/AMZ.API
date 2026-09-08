import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import AppearancePreference from "../src/renderer/src/components/appearance-preference";
import {
  applyUiAppearance, normalizeUiAppearance, readUiAppearance, saveUiAppearance,
  UI_ACCENT_STORAGE_KEY, UI_MODE_STORAGE_KEY,
} from "../src/renderer/src/ui-appearance";

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
});

describe("independent local appearance preferences", () => {
  it("preserves the original light palette by default and is safe during SSR", () => {
    expect(readUiAppearance(null)).toEqual({ accent: "default", mode: "light" });
    expect(() => applyUiAppearance({ accent: "pink", mode: "dark" }, null)).not.toThrow();
    expect(saveUiAppearance({ accent: "pink", mode: "dark" }, null)).toBe(false);
    const html = renderToStaticMarkup(createElement(AppearancePreference));
    expect(html).toContain("介面顏色");
    expect(html).toContain("原色");
    expect(html).toContain("粉紅色");
    expect(html).toContain('type="radio"');
    expect(html).toContain('role="switch"');
  });

  it.each([
    ["default", "light"], ["pink", "light"], ["default", "dark"], ["pink", "dark"],
  ] as const)("round trips %s / %s without changing the other display preference", (accent, mode) => {
    const entries = new Map<string, string>();
    const storage = { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); } };
    const root = { setAttribute: vi.fn() };
    expect(saveUiAppearance({ accent, mode }, storage)).toBe(true);
    expect(readUiAppearance(storage)).toEqual({ accent, mode });
    expect([...entries.keys()]).toEqual([UI_ACCENT_STORAGE_KEY, UI_MODE_STORAGE_KEY]);
    applyUiAppearance({ accent, mode }, root);
    expect(root.setAttribute.mock.calls).toEqual([["data-ui-accent", accent], ["data-ui-mode", mode]]);
  });

  it("allowlists values and tolerates denied storage without hiding failure", () => {
    expect(normalizeUiAppearance({ accent: "url(untrusted)", mode: "auto" })).toEqual({ accent: "default", mode: "light" });
    const denied = { getItem: () => { throw Error("blocked"); }, setItem: () => { throw Error("blocked"); } };
    expect(readUiAppearance(denied)).toEqual({ accent: "default", mode: "light" });
    expect(saveUiAppearance({ accent: "pink", mode: "dark" }, denied)).toBe(false);
    vi.stubGlobal("window", Object.defineProperty({}, "localStorage", { get() { throw Error("denied"); } }));
    expect(readUiAppearance()).toEqual({ accent: "default", mode: "light" });
  });

  it("places appearance immediately after font size and applies it before React mounts", async () => {
    const [settings, startup] = await Promise.all([
      readFile(new URL("../src/renderer/src/components/system-health-control.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/renderer/src/main.tsx", import.meta.url), "utf8"),
    ]);
    expect(settings.indexOf("<AppearancePreference />")).toBeGreaterThan(settings.indexOf('className="font-size-preference"'));
    expect(settings.indexOf("<AppearancePreference />")).toBeLessThan(settings.indexOf('className="health-advanced-details system-preferences-details"'));
    expect(startup.indexOf("applyUiAppearance(readUiAppearance());")).toBeLessThan(startup.indexOf("createRoot(document"));
  });

  it("switches pink and dark live without any API or Bridge request and restores on remount", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const entries = new Map<string, string>();
    const storage = { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); } };
    const setAttribute = vi.fn();
    const fetch = vi.fn();
    vi.stubGlobal("window", { localStorage: storage });
    vi.stubGlobal("document", { documentElement: { setAttribute } });
    vi.stubGlobal("fetch", fetch);
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(createElement(AppearancePreference)); });
    await act(async () => { renderer.root.findByProps({ value: "pink" }).props.onChange(); });
    await act(async () => { renderer.root.findByProps({ role: "switch" }).props.onChange({ target: { checked: true } }); });
    expect(readUiAppearance(storage)).toEqual({ accent: "pink", mode: "dark" });
    expect(setAttribute).toHaveBeenCalledWith("data-ui-mode", "dark");
    expect(fetch).not.toHaveBeenCalled();
    await act(async () => renderer.unmount());
    await act(async () => { renderer = create(createElement(AppearancePreference)); });
    expect(renderer.root.findByProps({ value: "pink" }).props.checked).toBe(true);
    expect(renderer.root.findByProps({ role: "switch" }).props.checked).toBe(true);
    await act(async () => { renderer.root.findByProps({ value: "default" }).props.onChange(); });
    expect(readUiAppearance(storage)).toEqual({ accent: "default", mode: "dark" });
    await act(async () => renderer.unmount());
  });
});
