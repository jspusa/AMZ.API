import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUDIT_SUITE_SECTIONS,
  type AuditSuiteSectionId,
} from "../src/shared/audit-suite";
import Dashboard, {
  DEFAULT_MARKETPLACE_ID,
} from "../src/renderer/src/components/dashboard";
import PriceListPanel from "../src/renderer/src/components/price-list-panel";
import type {
  SalesTrendPoint,
  SalesTrendSnapshot,
} from "../src/renderer/src/components/sales-trend-chart";

function salesTrendFixture(): SalesTrendSnapshot {
  const points: SalesTrendPoint[] = Array.from({ length: 7 }, (_, index) => ({
    date: `2026-08-${String(index + 1).padStart(2, "0")}`,
    interval: `2026-08-${String(index + 1).padStart(2, "0")}T00:00:00Z--2026-08-${String(index + 2).padStart(2, "0")}T00:00:00Z`,
    totalSales: { amount: 100 + index, currencyCode: "USD" },
    unitCount: 2,
    orderItemCount: 2,
    orderCount: 1,
    partial: false,
  }));
  const totals = {
    totalSales: { amount: 721, currencyCode: "USD" },
    unitCount: 14,
    orderItemCount: 14,
    orderCount: 7,
  };
  return {
    schemaVersion: 2,
    mode: "live",
    marketplaceId: DEFAULT_MARKETPLACE_ID,
    days: 7,
    timeZone: "America/Los_Angeles",
    range: {
      startDate: "2026-08-01",
      endDate: "2026-08-07",
      dayCount: 7,
      presetDays: 7,
    },
    points,
    totals,
    comparison: null,
    fetchedAt: "2026-08-07T12:00:00.000Z",
    requestId: null,
    rateLimit: "0.5",
    notice: "FBA-only interaction fixture.",
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT;
});

describe("dashboard audit workspace interactions", () => {
  it("opens and returns from every home audit without creating a modal", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;

    const animationFrames = new Map<number, FrameRequestCallback>();
    const timeouts = new Map<number, () => void>();
    let nextAnimationFrame = 1;
    let nextTimer = 1;
    let currentScrollY = 0;
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      const id = nextAnimationFrame++;
      animationFrames.set(id, callback);
      return id;
    });
    const cancelAnimationFrame = vi.fn((id: number) => {
      animationFrames.delete(id);
    });
    const setTimeoutMock = vi.fn((callback: () => void) => {
      const id = nextTimer++;
      timeouts.set(id, callback);
      return id;
    });
    const clearTimeoutMock = vi.fn((id: number) => {
      timeouts.delete(id);
    });
    const scrollTo = vi.fn((_left: number, top: number) => {
      currentScrollY = top;
    });
    const launchFocus = Object.fromEntries(
      AUDIT_SUITE_SECTIONS.map(({ id }) => [id, vi.fn()]),
    ) as Record<AuditSuiteSectionId, ReturnType<typeof vi.fn>>;
    const headingFocus = Object.fromEntries(
      AUDIT_SUITE_SECTIONS.map(({ label }) => [label, vi.fn()]),
    ) as Record<string, ReturnType<typeof vi.fn>>;
    const menuFocus = { "產品區": vi.fn(), "價格區": vi.fn() };
    const priceHeadingFocus = vi.fn();
    let renderer: ReactTestRenderer | null = null;
    const querySelector = vi.fn((selector: string) => {
      const sectionId = selector.match(
        /^\[data-audit-workspace-launch="([^"]+)"\]$/u,
      )?.[1] as AuditSuiteSectionId | undefined;
      const launchIsRendered = sectionId && renderer?.root.findAllByProps({
        "data-audit-workspace-launch": sectionId,
      }).length === 1;
      return sectionId && launchIsRendered && launchFocus[sectionId]
        ? { focus: launchFocus[sectionId] }
        : null;
    });
    const documentElement = {
      style: { scrollBehavior: "smooth" },
      setAttribute: vi.fn(),
    };
    const sectionTargets = new Map([
      "home-performance", "home-bulletin", "home-audits", "home-intelligence", "workspace-top",
    ].map((id) => [id, { focus: vi.fn(), scrollIntoView: vi.fn() }]));
    const windowMock = {
      get scrollY() {
        return currentScrollY;
      },
      set scrollY(value: number) {
        currentScrollY = value;
      },
      fbaOS: {
        app: {
          version: vi.fn(async () => "0.1.46"),
          openExternal: vi.fn(async () => undefined),
          openSellerCentralInventory: vi.fn(async () => undefined),
        },
        credentials: {
          test: vi.fn(async () => ({
            ok: true,
            testedAt: "2026-09-01T00:00:00.000Z",
            marketplaceId: DEFAULT_MARKETPLACE_ID,
            regions: {},
          })),
        },
      },
      location: { hash: "" },
      localStorage: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
      },
      requestAnimationFrame,
      cancelAnimationFrame,
      scrollTo,
      setTimeout: setTimeoutMock,
      clearTimeout: clearTimeoutMock,
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      confirm: vi.fn(() => true),
    };
    vi.stubGlobal("window", windowMock);
    vi.stubGlobal("document", {
      documentElement,
      visibilityState: "visible",
      querySelector,
      getElementById: vi.fn((id: string) => sectionTargets.get(id) ?? null),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    const fetchMock = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetchMock);

    const flushAnimationFrames = async () => {
      await act(async () => {
        let safety = 0;
        while (animationFrames.size > 0) {
          if (safety++ > 20) throw new Error("Animation frames did not settle");
          const pending = [...animationFrames.entries()];
          animationFrames.clear();
          pending.forEach(([, callback]) => callback(0));
        }
      });
    };
    const flushTimeouts = async () => {
      await act(async () => {
        let safety = 0;
        while (timeouts.size > 0) {
          if (safety++ > 20) throw new Error("Timers did not settle");
          const pending = [...timeouts.entries()];
          timeouts.clear();
          pending.forEach(([, callback]) => callback());
        }
      });
    };

    await act(async () => {
      renderer = create(createElement(Dashboard, {
        initialSalesTrend: salesTrendFixture(),
        initialMarketplaceId: DEFAULT_MARKETPLACE_ID,
      }), {
        createNodeMock: (element) => {
          if (element.type === "h2" && element.props.id === "price-list-title") {
            return { focus: priceHeadingFocus };
          }
          if (
            element.type === "h1" &&
            typeof element.props.children === "string" &&
            headingFocus[element.props.children]
          ) {
            return { focus: headingFocus[element.props.children] };
          }
          if (element.type === "nav") {
            return { contains: () => false, querySelectorAll: () => [] };
          }
          if (element.type === "button" && element.props["aria-label"] in menuFocus) {
            return { focus: menuFocus[element.props["aria-label"] as keyof typeof menuFocus] };
          }
          if (element.type === "h2") return { focus: vi.fn() };
          return {};
        },
      });
    });
    await flushTimeouts();
    const root = renderer!.root;

    expect(root.findAllByProps({ "aria-label": "首頁區段" })).toHaveLength(0);
    const requestsBeforeSectionNavigation = fetchMock.mock.calls.length;
    for (const link of [root.findByProps({ className: "workspace-skip-link" })]) {
      const id = link.props.href.slice(1);
      const target = root.findByProps({ id });
      expect(target.props.tabIndex).toBe(-1);
      const preventDefault = vi.fn();
      await act(async () => link.props.onClick({ preventDefault }));
      // Preventing the default preserves the exact trusted Notebook Key URL;
      // these links move focus and scroll without dispatching any API action.
      expect(preventDefault).toHaveBeenCalledOnce();
      expect(sectionTargets.get(id)!.scrollIntoView).toHaveBeenCalledWith(
        expect.objectContaining({ block: "start" }),
      );
      expect(sectionTargets.get(id)!.focus).toHaveBeenCalledWith({ preventScroll: true });
      expect(windowMock.location.hash).toBe("");
      expect(fetchMock).toHaveBeenCalledTimes(requestsBeforeSectionNavigation);
    }

    const shortcutCases = [
      ["產品區", "商品健檢", "home-audits", null],
      ["價格區", "Coupon／促銷", "home-intelligence", "promotions"],
      ["價格區", "Buy Box／價格", "home-intelligence", "price-health"],
      ["營運區", "公告日曆", "home-bulletin", null],
      ["營運區", "AWD 庫存", "home-intelligence", "awd"],
      ["營運區", "廣告成效", "home-intelligence", "advertising"],
      ["營運區", "事件", "home-intelligence", "events"],
      ["報表區", "銷售表現", "home-performance", null],
    ] as const;
    for (const [group, label, targetId, intelligenceView] of shortcutCases) {
      sectionTargets.get(targetId)!.focus.mockClear();
      sectionTargets.get(targetId)!.scrollIntoView.mockClear();
      await act(async () => root.findAllByType("button")
        .find((button) => button.props["aria-label"] === group)!.props.onClick());
      const item = root.findAllByProps({ role: "menuitem" })
        .find((button) => button.findByType("strong").children.join("") === label)!;
      const requestsBeforeShortcut = fetchMock.mock.calls.length;
      await act(async () => item.props.onClick());
      await flushAnimationFrames();
      expect(sectionTargets.get(targetId)!.scrollIntoView).toHaveBeenCalledWith(
        expect.objectContaining({ block: "start" }),
      );
      expect(sectionTargets.get(targetId)!.focus).toHaveBeenCalledWith({ preventScroll: true });
      expect(windowMock.location.hash).toBe("");
      expect(fetchMock).toHaveBeenCalledTimes(requestsBeforeShortcut);
      if (intelligenceView) {
        expect(root.findByProps({ className: "operations-intelligence-disclosure" }).props.open).toBe(true);
        expect(root.findByProps({ className: "oi-view-picker" }).findByType("select").props.value)
          .toBe(intelligenceView);
      }
    }

    const expectedNavigationGroup: Record<AuditSuiteSectionId, string> = {
      content: "產品區", image: "產品區", aplus: "產品區", variation: "產品區",
      subscription: "價格區", businessPricing: "價格區", advertising: "營運區",
    };

    for (const [index, section] of AUDIT_SUITE_SECTIONS.entries()) {
      const savedScrollY = 1_200 + index * 137;
      windowMock.scrollY = savedScrollY;
      scrollTo.mockClear();
      const launch = root.findByProps({
        "data-audit-workspace-launch": section.id,
      });

      await act(async () => launch.props.onClick());
      await flushAnimationFrames();

      const workspace = root.findByProps({ "data-audit-workspace": "true" });
      expect(root.findByProps({
        "data-audit-workspace-section": section.id,
      }).props.id).toBe("workspace-top");
      expect(workspace.findByType("h1").children.join("")).toBe(section.label);
      const currentLocation = root.findByProps({ "aria-current": "location" });
      expect(currentLocation.props["aria-label"]).toBe(expectedNavigationGroup[section.id]);
      expect(currentLocation.props.disabled).toBe(true);
      expect(headingFocus[section.label]).toHaveBeenCalledOnce();
      expect(root.findAll((node) => node.props.role === "dialog")).toHaveLength(0);
      expect(root.findAll((node) => node.props["aria-modal"] === true)).toHaveLength(0);
      expect(root.findAll((node) =>
        String(node.props.className ?? "").split(/\s+/u).includes("drawer-backdrop")
      )).toHaveLength(0);
      expect(root.findAllByProps({
        "data-audit-workspace-launch": section.id,
      })).toHaveLength(0);
      expect(scrollTo).toHaveBeenCalledWith(0, 0);
      expect(windowMock.scrollY).toBe(0);

      await act(async () => {
        workspace.findByProps({ className: "audit-workspace-back" })
          .props.onClick();
      });
      await flushTimeouts();
      await flushAnimationFrames();

      expect(root.findAllByProps({
        "data-audit-workspace-launch": section.id,
      })).toHaveLength(1);
      expect(querySelector).toHaveBeenLastCalledWith(
        `[data-audit-workspace-launch="${section.id}"]`,
      );
      expect(launchFocus[section.id]).toHaveBeenCalledWith({
        preventScroll: true,
      });
      expect(scrollTo).toHaveBeenLastCalledWith(0, savedScrollY);
      expect(windowMock.scrollY).toBe(savedScrollY);
      expect(root.findAllByProps({ "aria-current": "location" })).toHaveLength(0);
    }

    for (const [group, label, className] of [
      ["產品區", "變體", "variation-workspace"],
      ["價格區", "價目表", "price-list-workspace"],
    ] as const) {
      windowMock.scrollY = 900;
      await act(async () => root.findAllByType("button").find((button) => button.props["aria-label"] === group)!.props.onClick());
      const item = root.findAllByProps({ role: "menuitem" }).find((button) => button.findByType("strong").children.join("") === label)!;
      await act(async () => { item.props.onClick(); });
      await act(async () => { await vi.dynamicImportSettled(); });
      await flushAnimationFrames();
      expect(root.findAllByProps({ role: "dialog" })).toHaveLength(0);
      expect(root.findByProps({ className: "workspace-surface" }).props.inert).toBeUndefined();
      expect(root.findAllByType("button").find((button) => button.props["aria-label"] === group)!.props.disabled).toBe(true);
      const workspace = root.findAll((node) => typeof node.type === "string" && String(node.props.className ?? "").split(/\s+/u).includes(className))[0];
      expect(workspace).toBeDefined();
      const pricePanel = label === "價目表" ? root.findByType(PriceListPanel) : null;
      const back = workspace.findAllByType("button").find((button) => button.props["aria-label"] === "關閉變體規劃" || button.children.join("") === "← 返回首頁")!;
      expect(back).toBeDefined();
      await act(async () => back.props.onClick());
      await flushAnimationFrames();
      expect(menuFocus[group]).toHaveBeenCalledWith({ preventScroll: true });
      expect(scrollTo).toHaveBeenLastCalledWith({ top: 900, behavior: "instant" });
      expect(root.findAllByProps({ "data-audit-workspace-launch": "content" })).toHaveLength(1);
      if (pricePanel) {
        expect(priceHeadingFocus).toHaveBeenCalledTimes(1);
        // Returning home must retain the imported workbook and active read in
        // the same component instance; reopening must not create a new job.
        expect(root.findByType(PriceListPanel)).toBe(pricePanel);
        expect(root.findByProps({ "data-price-list-session": true }).props.hidden).toBe(true);
        await act(async () => root.findAllByType("button").find((button) => button.props["aria-label"] === group)!.props.onClick());
        const reopen = root.findAllByProps({ role: "menuitem" }).find((button) => button.findByType("strong").children.join("") === label)!;
        await act(async () => reopen.props.onClick());
        expect(root.findByType(PriceListPanel)).toBe(pricePanel);
        expect(root.findByProps({ "data-price-list-session": true }).props.hidden).toBe(false);
        expect(priceHeadingFocus).toHaveBeenCalledTimes(2);
        await act(async () => back.props.onClick());
      }
    }

    await act(async () => renderer!.unmount());
  });
});
