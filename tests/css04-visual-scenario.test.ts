import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const baselineUrl = new URL(
  "../scripts/visual-qa/renderer-visual-baseline.js",
  import.meta.url,
);
const fixtureUrl = new URL(
  "../scripts/visual-qa/renderer-visual-fixture.js",
  import.meta.url,
);

describe("CSS04 visual baseline scenario", () => {
  it("owns the final audit, report, inbound, interaction, and motion matrix", async () => {
    const source = await readFile(fileURLToPath(baselineUrl), "utf8");

    expect(source).toContain('key: "css04"');
    expect(source).toContain('marker: "css04-extra"');
    expect(source).toContain('evidenceDirectory: "css04-extra"');
    for (const profile of [
      "desktop-standard",
      "desktop-large",
      "compact-390-large",
      "compact-320-large",
      "desktop-reduced",
    ]) {
      expect(source).toContain(`"${profile}"`);
    }
    for (const surface of [
      "home-primary",
      "home-low-frequency",
      "image-results",
      "aged-switch",
      "brand-interactive",
      "ads-results",
      "reports",
      "reviews",
      "missing-bullets",
      "inbound-issues",
      "reduced-skater",
    ]) {
      expect(source).toContain(`"${surface}"`);
    }

    expect(source).toContain('case "css04":');
    expect(source).toContain("count + 10 + (profile.reduced ? 1 : 0)");
    expect(source).toContain('scopeSelector: ".health-audit-home-grid"');
    expect(source).toContain('requiredScrollers: compact ? [".report-library-toolbar nav"] : []');
    expect(source).toContain("expectedReportCategoryLabels");
    expect(source).toContain("reportCategoryButtons.count()");
    expect(source).toContain('name: "稅務", exact: true');
    expect(source).toContain('hasText: "CSS04 TAX"');
    expect(source).toContain("scrollTargetSelector = null");
    expect(source).toContain("viewportTargetSelector = null");
    expect(source).toContain('scrollTargetSelector: "section.brand-sales-card"');
    expect(source).toContain('viewportTargetSelector: ".brand-sales-pie-stage"');
    expect(source).not.toContain("windowScrollTop: 600");
    expect(source).toContain('requiredScrollers: compact ? [".inbound-item-table-scroll"] : []');
    expect(source).toContain('motionSelector: ".sales-skater.is-jumping"');
  });

  it("uses CSS04-only deterministic local read fixtures", async () => {
    const source = await readFile(fileURLToPath(fixtureUrl), "utf8");

    expect(source).toContain('const css04 = params.get("css04") === "1";');
    expect(source).toContain("const css04ImageJob =");
    expect(source).toContain("const css04AgedInventoryJob =");
    expect(source).toContain("const css04AdvertisingJob =");
    expect(source).toContain("const css04AdvertisingStrategyJob =");
    expect(source).toContain("const css04ReviewSnapshot =");
    expect(source).toContain("const css04ContentJob =");
    expect(source).toContain('request.path === "/api/amazon-ads/status"');
    expect(source).toContain('request.path === "/api/amazon-ads/strategy"');
    expect(source).toContain('request.path === "/api/sp-api/review-audit"');
    expect(source).not.toContain("http://localhost");
  });
});
