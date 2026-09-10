import { readFile } from "node:fs/promises";
import postcss from "postcss";
import { describe, expect, it } from "vitest";
import { nearestTrendPointIndex } from "../src/renderer/src/components/sales-trend-chart";
import { createDarkPalette } from "../scripts/generate-dark-palette.mjs";

const file = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
function contrast(a: string, b: string) {
  const luminance = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
    .reduce((n, v, i) => n + v * [.2126, .7152, .0722][i]!, 0);
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + .05) / (lo! + .05);
}

describe("compact charts and authored dark surfaces", () => {
  it.each([220, 320, 760, 1200])("maps pointer positions against a %ipx SVG rather than an obsolete fixed width", width => {
    const left = 23, renderedWidth = width * .8;
    const x = (ratio: number) => left + (66 + (width - 84) * ratio) / width * renderedWidth;
    expect(nearestTrendPointIndex(x(0), left, renderedWidth, 7, width)).toBe(0);
    expect(nearestTrendPointIndex(x(.5), left, renderedWidth, 7, width)).toBe(3);
    expect(nearestTrendPointIndex(x(1), left, renderedWidth, 7, width)).toBe(6);
    const compactMid = left + (88 + (width - 88 - 18) / 2) / width * renderedWidth;
    expect(nearestTrendPointIndex(compactMid, left, renderedWidth, 7, width, 88)).toBe(3);
    expect(nearestTrendPointIndex(-999, left, renderedWidth, 7, width)).toBe(0);
    expect(nearestTrendPointIndex(9999, left, renderedWidth, 7, width)).toBe(6);
  });

  it("rejects malformed pointer bounds without producing an invalid index", () => {
    for (const width of [0, 84, NaN, Infinity]) expect(nearestTrendPointIndex(50, 0, 320, 7, width)).toBeNull();
    expect(nearestTrendPointIndex(50, 0, Infinity, 7)).toBeNull();
    expect(nearestTrendPointIndex(50, 0, 320, NaN)).toBeNull();
  });

  it("keeps complete money on demand in a fixed detail rail without covering the share chart", async () => {
    const source = await file("src/renderer/src/components/brand-sales-chart.tsx");
    expect(source).not.toContain('className="brand-sales-selection"');
    expect(source).toContain('formatMoney(active.amount, snapshot.currencyCode)');
    expect(source).toContain('className="brand-sales-context-line"');
    expect(source).toContain('<small>{active.skuCount} SKU · {active.unitCount.toLocaleString()} 件</small>');
    expect(source).not.toContain('role="tooltip"');
    const css = postcss.parse(await file("src/renderer/src/styles/chart-compact.css"));
    const rail = new Map<string, string>();
    css.walkRules(rule => { if (rule.selector === '#home-performance .brand-sales-context-line') rule.walkDecls(d => { rail.set(d.prop, d.value); }); });
    expect(rail.get("min-height")).toBe("42px");
    expect(rail.get("overflow")).toBe("hidden");
    expect(css.toString()).toContain('clamp(154px, 38cqi, 196px)');
    expect(css.toString()).toContain('.brand-sales-legend-meter');
    const stage = new Map<string, string>();
    css.walkRules(rule => { if (rule.selector.endsWith('.brand-sales-pie-stage')) rule.walkDecls(d => { stage.set(d.prop, d.value); }); });
    expect(stage.get('grid-template-columns')).toBe('minmax(0, 1fr)');
    expect(stage.get('gap')).toBe('0');
    const chart = await file("src/renderer/src/components/sales-trend-chart.tsx");
    expect(chart).toContain('const chartHeight = skaterEnabled ? HEIGHT : 170');
    expect(chart).toContain('observer.disconnect()');
    expect(chart).toContain('viewBox={`0 0 ${chartWidth} ${chartHeight}`}');
    expect(chart).not.toContain('<p className="sales-period-note"');
    expect(chart).toContain('strokeDasharray="5 5"');
    expect(chart).toContain('active.point.partial ? "（即時）"');
  });

  it("does not re-convert intentional light or dark theme paint", async () => {
    const generated = createDarkPalette('.legacy { color:#123456; } :root[data-ui-mode="dark"] .manual { color:#ffb0ca; } :root[data-ui-mode="light"] .day {color:#000000;}');
    expect(generated).toContain('.legacy');
    expect(generated).not.toContain('.manual');
    expect(generated).not.toContain('.day');
    expect(createDarkPalette(await file('src/renderer/src/styles/appearance.css'))).not.toContain('--ui-dark-bg-share-control');
  });

  it("keeps text and selected controls readable on the authored neutral dark surfaces", async () => {
    const css = postcss.parse(await file("src/renderer/src/styles/dark-surfaces.css"));
    const tokens = new Map<string, string>();
    css.walkDecls(d => { if (d.prop.startsWith('--night-')) tokens.set(d.prop, d.value); });
    for (const ink of [tokens.get('--night-ink')!, tokens.get('--night-muted')!, '#a6ccff', '#ffb0ca']) {
      for (const paper of ['#101216', '#191d24', '#252b35']) expect(contrast(ink, paper)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast('#a6ccff', '#243b57')).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#ffb0ca', '#442635')).toBeGreaterThanOrEqual(4.5);
    css.walkRules(rule => { expect(rule.selector).toContain('data-ui-mode="dark"'); });
    css.walkDecls(d => {
      expect(d.prop).not.toMatch(/^(?:display|width|height|padding|margin|gap|grid|position|inset|transform|font-size)/u);
      if (d.prop === 'filter') expect(d.value).not.toMatch(/invert|hue-rotate/u);
      if (d.prop === 'background') expect(d.value).not.toContain('gradient');
    });
  });
});
