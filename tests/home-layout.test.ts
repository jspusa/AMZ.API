import { readFile } from "node:fs/promises";
import postcss, { type Root, type Rule } from "postcss";
import { describe, expect, it } from "vitest";
import { readRendererStylesheet } from "./renderer-stylesheet";

const grid = "#home-audits > .health-audit-home-grid";
const card = `${grid} > .content-audit-home-card`;

async function layout() {
  return postcss.parse(await readFile(new URL(
    "../src/renderer/src/styles/home-layout.css", import.meta.url,
  ), "utf8"));
}

function values(css: Root, selector: string, media: string | null = null) {
  const result = new Map<string, string>();
  css.walkRules((rule: Rule) => {
    if (!rule.selectors.includes(selector)) return;
    const parent = rule.parent;
    if (media === null ? parent?.type !== "root" :
      parent?.type !== "atrule" || parent.name !== "media" || parent.params !== media) return;
    rule.walkDecls((declaration) => { result.set(declaration.prop, declaration.value); });
  });
  return result;
}

describe("home layout repair", () => {
  it("keeps every tile the same width and centers incomplete rows without stretching them", async () => {
    const css = await layout();
    expect(values(css, grid).get("display")).toBe("flex");
    expect(values(css, grid).get("justify-content")).toBe("center");
    expect(values(css, grid).get("align-items")).toBe("stretch");
    expect(values(css, card).get("flex")).toBe("0 0 calc((100% - 72px) / 7)");
    expect(values(css, card, "(max-width: 1199px)").get("flex-basis"))
      .toBe("calc((100% - 36px) / 4)");
    expect(values(css, card, "(max-width: 760px)").get("flex-basis"))
      .toBe("calc((100% - 12px) / 2)");
    css.walkRules((rule) => { expect(rule.selector).not.toContain("nth-child"); });
  });

  it("assigns icon, title and genuine status separate explicit rows", async () => {
    const css = await layout();
    const icon = values(css, `${card} > .content-audit-home-icon`);
    const title = values(css, `${card} > div`);
    const status = values(css, `${card} > .content-audit-home-status`);
    expect(values(css, card).get("grid-template-columns")).toBe("minmax(0, 1fr)");
    expect(values(css, card).get("grid-template-rows")).toBe("44px minmax(24px, auto) auto");
    expect(icon.get("grid-row")).toBe("1");
    expect(icon.get("grid-column")).toBe("1");
    expect(icon.get("place-items")).toBe("center");
    expect(icon.get("width")).toBe("44px");
    expect(icon.get("height")).toBe("44px");
    expect(title.get("grid-row")).toBe("2");
    expect(title.get("text-align")).toBe("center");
    expect(status.get("grid-row")).toBe("3");
    expect(status.get("display")).toBe("flex");
    expect(status.get("overflow-wrap")).toBe("anywhere");
    expect(values(css, card).get("overflow")).toBe("visible");
    expect(values(css, `${card} > button.audit-card-hit-area::after`).get("content"))
      .toBe("none");
  });

  it("shares page rails and keeps compact headings and disclosure controls on one row", async () => {
    const css = await layout();
    for (const selector of ["#home-performance.operations-overview-grid", "#home-bulletin > .operations-bulletin"]) {
      expect(values(css, selector).get("width")).toBe("100%");
      expect(values(css, selector).get("max-width")).toBe("none");
    }
    expect(values(css, "#home-audits > .home-section-heading").get("flex-direction"))
      .toBe("row");
    expect(values(css, "#home-audits > .home-section-heading").get("align-items"))
      .toBe("center");
    expect(values(css, "#home-bulletin > .operations-bulletin > summary").get("grid-template-columns"))
      .toBe("38px minmax(0, 1fr) auto 28px");
    expect(values(css, ".workspace-header-main", "(max-width: 960px)").get("grid-template-columns"))
      .toBe("minmax(0, 1fr) auto");
  });

  it("changes layout only and participates in the verified production stylesheet stream", async () => {
    const css = await layout();
    css.walkDecls((declaration) => {
      expect(declaration.prop).not.toMatch(/^(?:color|background(?:-.+)?|border(?:-.+)?-color|fill|stroke|--audit-state-.+)$/u);
    });
    const composed = await readRendererStylesheet();
    expect(composed).toContain("Home layout repair: one set of rails");
    expect(composed.indexOf("Home layout repair: one set of rails"))
      .toBeLessThan(composed.indexOf("/* Variation workspace: readable tables"));
  });
});
