import { readFile } from "node:fs/promises";
import { DOMParser } from "@xmldom/xmldom";
import { renderToStaticMarkup } from "react-dom/server";
import postcss, { type Declaration, type Rule } from "postcss";
import { describe, expect, it } from "vitest";
import Dashboard, { DEFAULT_MARKETPLACE_ID } from "../src/renderer/src/components/dashboard";

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
  it("provides a visible page heading and three focusable same-page section destinations", () => {
    const document = initialHome();
    const headings = Array.from(document.getElementsByTagName("h1"));
    expect(headings).toHaveLength(1);
    const heading = headings[0]!;
    expect(heading.getAttribute("class") ?? "").not.toContain("visually-hidden");
    expect(heading.hasAttribute("hidden")).toBe(false);
    const visibleHeadingText = Array.from(heading.childNodes)
      .filter((node) => node.nodeType === 3).map((node) => node.textContent).join("").trim();
    expect(visibleHeadingText.length).toBeGreaterThan(0);

    const sectionNavigation = Array.from(document.getElementsByTagName("nav"))
      .find((element) => element.getAttribute("aria-label") === "首頁區段")!;
    expect(sectionNavigation).toBeDefined();
    const links = Array.from(sectionNavigation.getElementsByTagName("a"));
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "#home-performance", "#home-bulletin", "#home-audits",
    ]);
    for (const link of links) {
      const id = link.getAttribute("href")!.slice(1);
      const destinations = Array.from(document.getElementsByTagName("*"))
        .filter((element) => element.getAttribute("id") === id);
      expect(destinations).toHaveLength(1);
      expect(destinations[0]!.getAttribute("tabindex")).toBe("-1");
      expect(link.textContent?.trim().length).toBeGreaterThan(0);
    }
  });

  it("labels all seven unrun audits without fabricating completed counts or progress", () => {
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
    for (const card of auditCards) {
      const statuses = Array.from(card.getElementsByTagName("span")).filter((span) =>
        (span.getAttribute("class") ?? "").split(/\s+/u).includes("content-audit-home-status")
      );
      expect(statuses).toHaveLength(1);
      expect(statuses[0]!.textContent).toContain("尚未執行");
      expect(statuses[0]!.textContent).not.toMatch(/[\d%]|已完成|成功|正常/u);
      expect(card.getElementsByTagName("progress").length).toBe(0);
    }
  });
});

describe("commercial dashboard final-layer accessibility guards", () => {
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
