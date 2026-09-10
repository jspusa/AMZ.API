import { readFile } from "node:fs/promises";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

const path = new URL("../src/renderer/src/styles/appearance.css", import.meta.url);
function luminance(hex: string): number {
  const rgb = hex.match(/[a-f\d]{2}/giu)!.map((part) => parseInt(part, 16) / 255)
    .map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}
function contrast(a: string, b: string): number {
  const values = [luminance(a), luminance(b)].sort((x,y) => y-x);
  return (values[0] + .05) / (values[1] + .05);
}
describe("sweet pink appearance", () => {
  it("uses solid blush surfaces rather than purple gradients", async () => {
    const css = postcss.parse(await readFile(path, "utf8"));
    let pinkRules = 0;
    css.walkRules((rule) => {
      if (!rule.selector.includes('data-ui-accent="pink"') && !rule.selector.includes(".appearance-swatch.is-pink")) return;
      pinkRules++;
      rule.walkDecls((decl) => { expect(decl.value).not.toContain("gradient("); });
    });
    expect(pinkRules).toBeGreaterThan(20);
  });
  it("retains readable foregrounds for the blush navigation and primary action", () => {
    for (const pair of [["88324d","ffe5ed"],["5b3443","fff7fa"],["ffffff","c92f63"],["b22f58","ffe5ed"]]) {
      expect(contrast(pair[0],pair[1])).toBeGreaterThanOrEqual(4.5);
    }
  });
});
