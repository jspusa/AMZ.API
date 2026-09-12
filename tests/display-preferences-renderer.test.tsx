import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import { DisplayPreferencesStore } from "../src/main/display-preferences";
import { initializeDisplayPreferences, nativeDisplayPreferences } from "../src/renderer/src/display-preferences-client";
import AppearancePreference from "../src/renderer/src/components/appearance-preference";
import SystemHealthControl from "../src/renderer/src/components/system-health-control";
vi.mock("react-dom", async (load) => ({ ...await load<typeof import("react-dom")>(), createPortal: (children: unknown) => children }));
let directory: string | undefined;
let renderer: ReactTestRenderer | undefined;
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); if (directory) await rm(directory, { recursive: true, force: true }); vi.unstubAllGlobals(); });
function freshSession(path: string) {
  const owner = new DisplayPreferencesStore(path);
  const update = vi.fn((patch: unknown) => owner.update(patch));
  const attributes = new Map<string, string>();
  vi.stubGlobal("window", {
    fbaOS: { preferences: { read: () => owner.read(), update }, app: { version: async () => "0.1.63" } },
    localStorage: { getItem: () => null, setItem: () => { throw Error("Browser persistence is unavailable"); } },
    setTimeout: () => 1, clearTimeout: vi.fn(), setInterval: () => 1, clearInterval: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  });
  vi.stubGlobal("document", { documentElement: { setAttribute: (key: string, value: string) => attributes.set(key, value) } });
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
  return { update, attributes };
}
it("restores font size, accent and dark mode after a complete new session with empty browser storage", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  directory = await mkdtemp(join(tmpdir(), "amz-display-renderer-"));
  const path = join(directory, "display-preferences.json");
  const first = freshSession(path);
  await initializeDisplayPreferences();
  await act(async () => { renderer = create(createElement(SystemHealthControl, { marketplaceId: "ATVPDKIKX0DER" })); });
  await act(async () => renderer!.root.findAllByType("button").find(node => node.props["aria-haspopup"] === "dialog")!.props.onClick());
  await act(async () => renderer!.root.findAllByProps({ role: "radio" }).find(node => node.children.join("") === "大")!.props.onClick());
  await act(async () => renderer!.root.findByProps({ value: "pink" }).props.onChange());
  await act(async () => renderer!.root.findByProps({ role: "switch" }).props.onChange({ target: { checked: true } }));
  await act(async () => { await Promise.all(first.update.mock.results.map(result => result.value)); });
  await act(async () => renderer!.unmount());
  renderer = undefined;
  const second = freshSession(path);
  await initializeDisplayPreferences();
  await act(async () => { renderer = create(createElement(AppearancePreference)); });
  expect(renderer!.root.findByProps({ value: "pink" }).props.checked).toBe(true);
  expect(renderer!.root.findByProps({ role: "switch" }).props.checked).toBe(true);
  expect(second.attributes.get("data-ui-font-size")).toBe("large");
  expect(second.attributes.get("data-ui-accent")).toBe("pink");
  expect(second.attributes.get("data-ui-mode")).toBe("dark");
  expect(nativeDisplayPreferences()?.fontSize).toBe("large");
  expect(second.update).not.toHaveBeenCalled();
});
