import { readFile } from "node:fs/promises";
import { DOMParser } from "@xmldom/xmldom";
import { renderToStaticMarkup } from "react-dom/server";
import postcss, { type Declaration, type Rule } from "postcss";
import { describe, expect, it } from "vitest";
import Dashboard, {
  DEFAULT_MARKETPLACE_ID,
  WORKSPACE_SHORTCUTS,
  auditCardVisualState,
} from "../src/renderer/src/components/dashboard";

function initialHome() {
  return new DOMParser().parseFromString(renderToStaticMarkup(
    <Dashboard initialSalesTrend={null} initialMarketplaceId={DEFAULT_MARKETPLACE_ID} />,
  ), "text/html");
}

async function redesignStyles() {
  return postcss.parse(await readFile(new URL(
    "../src/renderer/src/styles/workspace-redesign.css", import.meta.url,
  ), "utf8"));
}

async function salesRedesignStyles() {
  return postcss.parse(await readFile(new URL(
    "../src/renderer/src/styles/sales-redesign.css", import.meta.url,
  ), "utf8"));
}

function declarations(rules: readonly Rule[], selector: string) {
  const result = new Map<string, Declaration>();
  for (const rule of rules) {
    if (rule.selectors.includes(selector)) {
      rule.walkDecls((declaration) => { result.set(declaration.prop, declaration); });
    }
  }
  return result;
}

describe("commercial dashboard navigation and empty-state honesty", () => {
  it("keeps one accessible page heading and four focusable menu destinations without a duplicate section nav", () => {
    const document = initialHome();
    const headings = Array.from(document.getElementsByTagName("h1"));
    expect(headings).toHaveLength(1);
    const heading = headings[0]!;
    expect(heading.getAttribute("class") ?? "").toContain("visually-hidden");
    expect(heading.hasAttribute("hidden")).toBe(false);
    expect(heading.textContent?.trim()).toBe("AMZ.API FBA 營運首頁");

    const sectionNavigation = Array.from(document.getElementsByTagName("nav"))
      .find((element) => element.getAttribute("aria-label") === "首頁區段");
    expect(sectionNavigation).toBeUndefined();
    for (const id of ["home-performance", "home-bulletin", "home-audits", "home-intelligence"]) {
      const destinations = Array.from(document.getElementsByTagName("*"))
        .filter((element) => element.getAttribute("id") === id);
      expect(destinations).toHaveLength(1);
      expect(destinations[0]!.getAttribute("tabindex")).toBe("-1");
    }
    expect(WORKSPACE_SHORTCUTS.map(({ targetId }) => targetId)).toEqual([
      "home-audits",
      "home-intelligence",
      "home-intelligence",
      "home-bulletin",
      "home-intelligence",
      "home-intelligence",
      "home-intelligence",
      "home-performance",
    ]);
  });

  it("makes all seven unrun audit cards the action without visible action labels", () => {
    const document = initialHome();
    const auditCards = Array.from(document.getElementsByTagName("section")).filter((section) =>
      Array.from(section.getElementsByTagName("button")).some((button) =>
        button.hasAttribute("data-audit-workspace-launch")
      ) && section.getAttribute("id") !== "home-audits"
    );
    expect(auditCards).toHaveLength(7);
    expect(auditCards.map((card) => Array.from(card.getElementsByTagName("button"))
      .find((button) => button.hasAttribute("data-audit-workspace-launch"))!
      .getAttribute("data-audit-workspace-launch"))).toEqual([
      "content", "image", "aplus", "variation", "subscription", "businessPricing", "advertising",
    ]);
    const expectedActions = ["執行", "執行", "執行", "執行", "執行", "執行", "開啟"];
    auditCards.forEach((card, index) => {
      expect(card.getAttribute("data-audit-state")).toBe("idle");
      const statuses = Array.from(card.getElementsByTagName("span")).filter((span) =>
        (span.getAttribute("class") ?? "").split(/\s+/u).includes("content-audit-home-status")
      );
      expect(statuses).toHaveLength(0);
      expect(card.getElementsByTagName("progress").length).toBe(0);
      const launch = Array.from(card.getElementsByTagName("button"))
        .find((button) => button.hasAttribute("data-audit-workspace-launch"))!;
      expect(launch.getAttribute("class")).toContain("audit-card-hit-area");
      expect(launch.getAttribute("aria-label")).toContain(expectedActions[index]);
      expect(launch.textContent).toBe("");
      expect(launch.textContent).not.toMatch(/[\d%]|已完成|成功|正常/u);
    });
  });

  it("maps honest audit outcomes to one visual state", () => {
    expect(auditCardVisualState({
      hasFailure: false,
      isRunning: false,
      terminalOutcome: null,
    })).toBe("idle");
    expect(auditCardVisualState({
      hasFailure: false,
      isRunning: true,
      terminalOutcome: null,
    })).toBe("running");
    expect(auditCardVisualState({
      hasFailure: false,
      isRunning: false,
      terminalOutcome: "partial",
    })).toBe("partial");
    expect(auditCardVisualState({
      hasFailure: true,
      isRunning: false,
      terminalOutcome: "success",
    })).toBe("failed");
  });

  it("covers each audit card with one responsive state-colored action", async () => {
    const css = await redesignStyles();
    const rules: Rule[] = [];
    const mobileRules: Rule[] = [];
    css.walkRules((rule) => { rules.push(rule); });
    css.walkAtRules("media", (media) => {
      if (/max-width:\s*680px/u.test(media.params)) {
        media.walkRules((rule) => { mobileRules.push(rule); });
      }
    });

    const hitArea = declarations(
      rules,
      "#home-audits > .health-audit-home-grid > .content-audit-home-card > button.audit-card-hit-area",
    );
    expect(hitArea.get("position")?.value).toBe("absolute");
    expect(hitArea.get("inset")?.value).toBe("0");
    expect(hitArea.get("grid-column")?.value).toBe("auto");
    expect(hitArea.get("width")?.value).toBe("100%");
    expect(declarations(
      rules,
      '#home-audits > .health-audit-home-grid > .content-audit-home-card[data-audit-state="partial"]',
    ).get("--audit-state-color")?.value).toBe("#9a691d");
    expect(declarations(
      mobileRules,
      "#home-audits > .health-audit-home-grid > .content-audit-home-card:nth-child(n + 5):nth-child(-n + 7)",
    ).get("grid-column")?.value).toBe("auto");
  });
});

describe("commercial dashboard final-layer accessibility guards", () => {
  it("uses the application icon as an anchor while giving work zones distinct restrained tints", async () => {
    const [icon, workspace, sales, audit, bulletin, salesChart] = await Promise.all([
      readFile(new URL("../build/icon.svg", import.meta.url), "utf8"),
      readFile(new URL("../src/renderer/src/styles/workspace-redesign.css", import.meta.url), "utf8"),
      readFile(new URL("../src/renderer/src/styles/sales-redesign.css", import.meta.url), "utf8"),
      readFile(new URL("../src/renderer/src/styles/audit-suite-redesign.css", import.meta.url), "utf8"),
      readFile(new URL("../src/renderer/src/styles/bulletin-redesign.css", import.meta.url), "utf8"),
      readFile(new URL("../src/renderer/src/components/sales-trend-chart.tsx", import.meta.url), "utf8"),
    ]);

    for (const color of ["#2b3a53", "#101827", "#e32636"]) {
      expect(icon.toLowerCase()).toContain(color);
      expect(workspace.toLowerCase()).toContain(color);
    }
    expect(workspace).toContain("linear-gradient(112deg, #2b3a53 0%, #101827 78%)");
    expect(sales).toContain("--sales-primary: #2b3a53");
    expect(bulletin).toContain("--bulletin-brand: #2b3a53");
    expect(audit).toContain(".automation-badge.automatic");
    expect(audit).toContain("background: #e5eee3");
    expect(audit).toContain(".automation-badge.one_click");
    expect(bulletin).toContain("--bulletin-manual: #fff4ce");

    for (const color of ["#f4f0e9", "#edf3f7", "#f8f0e2", "#f6ebec"]) {
      expect(workspace.toLowerCase()).toContain(color);
    }
    expect(workspace).toContain("--audit-accent: #4b6f8f");
    expect(workspace).toContain("--audit-accent: #855a25");
    expect(workspace).toContain("--audit-accent: #9a4f5a");
    expect(new Set(Array.from(workspace.matchAll(/--audit-accent:\s*(#[0-9a-f]{6})/giu))
      .map((match) => match[1]?.toLowerCase()))).toEqual(new Set([
        "#4b6f8f", "#855a25", "#9a4f5a",
      ]));
    expect(sales).toContain(".sales-trend-line.is-current { stroke: #e78700");
    expect(salesChart).toContain('stopColor="#ff9900"');
    expect(bulletin).toContain("linear-gradient(90deg, #d9942a, #e32636 50%, #4b7ca3)");
    expect(audit).toContain("background: #e78700");

    const combinedTheme = `${workspace}\n${sales}\n${audit}\n${bulletin}`;
    expect(combinedTheme).not.toMatch(/#254f46|#243c35|#f5f5f0/iu);
  });

  it("keeps long sales totals on one responsive line and restores the golden data series", async () => {
    const css = await salesRedesignStyles();
    const rules: Rule[] = [];
    css.walkRules((rule) => { rules.push(rule); });

    const total = declarations(rules, ".sales-trend .sales-trend-total > strong");
    expect(total.get("white-space")?.value).toBe("nowrap");
    expect(total.get("overflow-wrap")?.value).toBe("normal");
    expect(total.get("word-break")?.value).toBe("keep-all");
    expect(total.get("font-size")?.value).toBe("clamp(28px, 3.35vw, 46px)");
    expect(declarations(rules, ".sales-trend .sales-trend-summary > .sales-trend-total")
      .get("min-width")?.value).toBe("min(100%, 19.5rem)");
    expect(declarations(rules, ".sales-trend-line.is-current").get("stroke")?.value)
      .toBe("#e78700");
    expect(declarations(rules, ".sales-trend .sales-trend-range button")
      .get("white-space")?.value).toBe("nowrap");
    expect(declarations(rules, ".sales-trend .sales-trend-toolbar").get("display")?.value)
      .toBe("flex");
    expect(declarations(rules, ".brand-sales-card .brand-sales-legend")
      .get("grid-template-columns")?.value).toBe("repeat(2, minmax(0, 1fr))");
  });

  it("allows narrow header tracks to shrink and avoids a second sticky header on small screens", async () => {
    const css = await redesignStyles();
    const smallRules: Rule[] = [];
    const tabletRules: Rule[] = [];
    css.walkAtRules("media", (media) => {
      if (/max-width:\s*680px/u.test(media.params)) media.walkRules((rule) => { smallRules.push(rule); });
      if (/max-width:\s*960px/u.test(media.params)) media.walkRules((rule) => { tabletRules.push(rule); });
    });
    // Both breakpoints apply to 320 px. These structural guards do not claim
    // pixel-level overflow measurement in a live browser.
    for (const selector of [".workspace-contextbar", ".workspace-primary-nav"]) {
      expect(declarations(smallRules, selector).get("grid-template-columns")?.value)
        .toMatch(/minmax\(0,\s*1fr\)/u);
    }
    expect(declarations(smallRules, ".workspace-primary-group").get("min-width")?.value).toBe("0");
    expect(declarations(smallRules, ".workspace-contextbar .global-marketplace select").get("max-width")?.value)
      .toMatch(/^(none|100%)$/u);
    const compactConnection = declarations(
      smallRules,
      ".workspace-header .workspace-connection-status.mode-badge",
    );
    expect(compactConnection.get("width")?.value).toBe("auto");
    expect(compactConnection.get("min-width")?.value).toBe("0");
    expect(declarations(tabletRules, ".audit-workspace-header").get("position")?.value).toBe("static");
  });

  it("disables added motion and smooth scrolling for reduced-motion users", async () => {
    const css = await redesignStyles();
    const rules: Rule[] = [];
    css.walkAtRules("media", (media) => {
      if (/prefers-reduced-motion:\s*reduce/u.test(media.params)) {
        media.walkRules((rule) => { rules.push(rule); });
      }
    });
    const allContent = declarations(rules, ".commerce-os *");
    for (const property of ["animation", "transition"]) {
      expect(allContent.get(property)?.value).toBe("none");
      expect(allContent.get(property)?.important).toBe(true);
    }
    expect(allContent.get("scroll-behavior")?.value).toBe("auto");
    expect(allContent.get("scroll-behavior")?.important).toBe(true);
    expect(declarations(rules, ".health-audit-home-grid .content-audit-home-card:hover").get("translate")?.value)
      .toBe("none");
    expect(declarations(rules, ".health-audit-home-grid .content-audit-home-card > button:active:not(:disabled)")
      .get("transform")?.value).toBe("none");
  });
});
