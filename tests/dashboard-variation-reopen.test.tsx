import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import Dashboard from "../src/renderer/src/components/dashboard";

let renderer: ReactTestRenderer | undefined;
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); vi.unstubAllGlobals(); });
it("opens My Variations after completing the home variation audit without losing its result or repeating the audit", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const windowStub = { localStorage: { getItem: () => null, setItem: () => undefined },
    fbaOS: { app: { version: async () => "0.1.63" } },
    setTimeout: () => 1, clearTimeout: vi.fn(), setInterval: () => 1, clearInterval: vi.fn(),
    requestAnimationFrame: () => 1, cancelAnimationFrame: vi.fn(), scrollTo: vi.fn(), scrollY: 0,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), location: { hash: "" } };
  vi.stubGlobal("window", windowStub);
  vi.stubGlobal("document", { documentElement: { setAttribute: vi.fn(), style: {} },
    visibilityState: "visible", addEventListener: vi.fn(), removeEventListener: vi.fn(),
    querySelector: () => null, getElementById: () => null });
  const snapshot = { mode: "live", marketplaceId: "ATVPDKIKX0DER", exportId: "synthetic-export", fetchedAt: "2026-09-12T00:00:00Z",
    rows: [{ sellerSku: "SYNTHETIC", asin: "B000000001", title: "Synthetic", productType: "PET_FOOD", relationshipEvidence: "relationships", notice: "Verified" }],
    incompleteRows: [], allVariationRows: [], summary: { totalFbaListings: 1, completed: 1, unbound: 1, boundChildren: 0, parentContainers: 0, incomplete: 0 }, notice: "Read only" };
  const fetchMock = vi.fn(async (input: string, options?: RequestInit) => {
    if (input === "/api/sp-api/standalone-audit" && options?.method === "POST") return Response.json({
      jobId: "10000000-0000-4000-8000-000000000001", contextId: "10000000-0000-4000-8000-000000000002", kind: "variation",
      marketplaceId: "ATVPDKIKX0DER", mode: "live", options: {}, ready: true, status: "completed", snapshot,
      progress: { stage: "complete", message: "Done", completedUnits: 1, totalUnits: 1 } });
    return new Promise<Response>(() => undefined);
  });
  vi.stubGlobal("fetch", fetchMock);
  await act(async () => { renderer = create(createElement(Dashboard, { initialSalesTrend: null }), { createNodeMock: () => ({ focus: vi.fn(), contains: () => false, querySelectorAll: () => [], closest: () => null, addEventListener: vi.fn(), removeEventListener: vi.fn(), isConnected: true }) }); });
  const root = renderer!.root;
  await act(async () => root.findByProps({ "data-audit-workspace-launch": "variation" }).props.onClick());
  const scan = root.findAllByType("button").find(node => node.children.join("").includes("掃描 US 全部 FBA 變體關係"))!;
  expect(scan).toBeDefined();
  await act(async () => { await scan.props.onClick(); });
  expect(root.findByProps({ "aria-label": "未綁變體健檢摘要" })).toBeTruthy();
  await act(async () => root.findByProps({ className: "audit-workspace-back" }).props.onClick());
  await act(async () => root.findByProps({ "aria-label": "產品區" }).props.onClick());
  await act(async () => root.findAllByProps({ role: "menuitem" }).find(node => node.findByType("strong").children.join("") === "變體")!.props.onClick());
  await act(async () => { await vi.dynamicImportSettled(); });
  expect(JSON.stringify(renderer!.toJSON())).not.toContain("無法載入此工作區");
  expect(root.findByProps({ "aria-label": "準備綁定 SYNTHETIC" })).toBeTruthy();
  expect(fetchMock.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
  expect(fetchMock.mock.calls.filter(([, options]) => options?.method === "PATCH")).toHaveLength(0);
});
