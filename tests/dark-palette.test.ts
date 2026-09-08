import { readFile } from "node:fs/promises";
import postcss from "postcss";
import { describe, expect, it } from "vitest";
import { createDarkPalette, darkColor } from "../scripts/generate-dark-palette.mjs";

function luminance(hex: string) {
  const linear = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
  return linear[0]! * .2126 + linear[1]! * .7152 + linear[2]! * .0722;
}

describe("paint-only dark palette", () => {
  it("preserves layout, hit areas, assets and state ordering without CSS inversion", () => {
    const source = ':root { --ink: #123456; } .card { padding: 12px; border: 4px solid #ddd; color: var(--ink); background: url("https://example.invalid/white.svg") #fff; } .card:hover { color: #f00; } @media (max-width: 680px) { .card { padding: 8px; border-left-width: 1px; background: transparent; } }';
    const dark = createDarkPalette(source);
    expect(dark).toBe(createDarkPalette(source));
    expect(dark).not.toMatch(/padding:|border-left-width:|invert\(|hue-rotate\(/u);
    expect(dark).toContain('url("https://example.invalid/white.svg")');
    expect(dark).toContain('border-color:');
    expect(dark).toContain('var(--ui-dark-fg-ink)');
    expect(dark).toContain(':where(:root[data-ui-mode="dark"]) .card:hover');
    expect(dark).toContain('@media (max-width: 680px)');
    expect(dark).toContain('background: transparent');
  });

  it("keeps separate foreground and surface aliases even when a legacy variable serves both", () => {
    const output = createDarkPalette(':root { --navy: #2b3a53; --alias: var(--navy); } .a { color: var(--alias); background: var(--navy); }');
    expect(output).toContain('--ui-dark-fg-alias: var(--ui-dark-fg-navy)');
    expect(output).toContain('color: var(--ui-dark-fg-alias)');
    expect(output).toContain('background: var(--ui-dark-bg-navy)');
  });

  it("makes representative text readable on dark surfaces and retains red/green signals", () => {
    for (const ink of ["#1e293b", "#77777d", "#666b78", "#3f7654", "#9a691d", "#a04450"]) {
      const foreground = luminance(darkColor(ink, "fg"));
      for (const paper of ["#fff", "#fafafd", "#f4f0e9", "#e7f2ea", "#fae8eb"]) {
        const background = luminance(darkColor(paper, "bg"));
        expect((foreground + .05) / (background + .05)).toBeGreaterThan(4.5);
      }
    }
    const green = darkColor("#3f7654", "fg");
    const red = darkColor("#a04450", "fg");
    expect(parseInt(green.slice(3, 5), 16)).toBeGreaterThan(parseInt(green.slice(1, 3), 16));
    expect(parseInt(red.slice(1, 3), 16)).toBeGreaterThan(parseInt(red.slice(3, 5), 16));
  });

  it("ships a deterministic scoped palette without geometry or image filtering", async () => {
    const manifest = await readFile(new URL("../src/renderer/src/styles/index.css", import.meta.url), "utf8");
    const files = [...manifest.matchAll(/@import "\.\/([^"]+)";/gu)].map((m) => m[1]!)
      .filter((name) => name !== "dark-palette.generated.css");
    const css = (await Promise.all(files.map((name) => readFile(new URL(`../src/renderer/src/styles/${name}`, import.meta.url), "utf8")))).join("").replace(/\r\n?/gu, "\n");
    const actual = await readFile(new URL("../src/renderer/src/styles/dark-palette.generated.css", import.meta.url), "utf8");
    expect(actual).toBe(createDarkPalette(css));
    const root = postcss.parse(actual);
    root.walkRules((rule) => { expect(rule.selector).toContain('data-ui-mode="dark"'); });
    root.walkDecls((decl) => {
      expect(decl.prop).not.toMatch(/^(?:display|width|height|padding|margin|gap|grid|position|inset|transform|translate|font-size|border-width)/u);
      if (decl.prop === "filter") expect(decl.value).not.toMatch(/invert|hue-rotate/u);
    });
  });
});
