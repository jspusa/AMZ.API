import postcss, { type Root } from "postcss";
import { describe, expect, it } from "vitest";
import { readRendererStylesheet } from "./renderer-stylesheet";

const panel = ".image-audit-panel";
const field = `${panel} > .ops-marketplace.image-audit-minimum`;
function declarations(root: Root, selector: string, media: string | null = null) {
  const values = new Map<string, string>();
  root.walkRules(rule => {
    if (!rule.selectors.includes(selector)) return;
    const parent = rule.parent;
    if (media === null ? parent?.type !== "root" :
      parent?.type !== "atrule" || parent.name !== "media" || parent.params !== media) return;
    rule.walkDecls(decl => { values.set(decl.prop, decl.value); });
  });
  return values;
}
async function stylesheet() { return postcss.parse(await readRendererStylesheet()); }

describe("image audit compact controls", () => {
  it("removes the redundant homepage picker from visual and keyboard layout", async () => {
    const css = await stylesheet();
    expect(declarations(css, "#home-audits .home-section-heading > .home-image-minimum").get("display"))
      .toBe("none");
    expect(declarations(css, field).get("display")).toBe("inline-flex");
  });

  it("keeps the inner number selector compact without shrinking its touch target", async () => {
    const css = await stylesheet();
    expect(declarations(css, field).get("flex-direction")).toBe("row");
    expect(declarations(css, field).get("align-items")).toBe("center");
    expect(declarations(css, field).get("width")).toBe("auto");
    expect(declarations(css, `${field} > select`).get("width")).toBe("6.5rem");
    expect(declarations(css, `${field} > select`).get("min-height")).toBe("40px");
    expect(declarations(css, `${field} > select`).get("flex")).toBe("0 0 6.5rem");
  });

  it("pairs setup and launch while preserving full-width result and status tracks", async () => {
    const css = await stylesheet();
    expect(declarations(css, panel).get("display")).toBe("grid");
    expect(declarations(css, panel).get("grid-template-columns"))
      .toBe("minmax(0, max-content) minmax(0, 1fr)");
    expect(declarations(css, `${panel} > *`).get("grid-column")).toBe("1 / -1");
    expect(declarations(css, field).get("grid-column")).toBe("1");
    expect(declarations(css, `${panel} > .price-primary-button`).get("grid-column")).toBe("2");
    expect(declarations(css, `${panel} > .price-primary-button`).get("width")).toBe("auto");
  });

  it("stacks the launch button on phones but never stretches the number selector", async () => {
    const css = await stylesheet();
    expect(declarations(css, panel, "(max-width: 680px)").get("grid-template-columns"))
      .toBe("minmax(0, 1fr)");
    expect(declarations(css, `${panel} > .price-primary-button`, "(max-width: 680px)").get("grid-column"))
      .toBe("1");
    expect(declarations(css, field).get("flex-wrap")).toBe("wrap");
    expect(declarations(css, `${field} > select`).get("max-width")).toBe("100%");
  });
});
