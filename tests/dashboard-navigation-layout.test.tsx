import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Dashboard, {
  DEFAULT_MARKETPLACE_ID,
} from "../src/renderer/src/components/dashboard";

describe("dashboard top navigation layout", () => {
  it("puts every workspace tool in the centered header and removes side navigation", () => {
    const markup = renderToStaticMarkup(
      <Dashboard
        initialSalesTrend={null}
        initialMarketplaceId={DEFAULT_MARKETPLACE_ID}
        initialError="Sales API 暫時無法同步。"
      />,
    );
    const navigation = markup.match(
      /<nav class="workspace-primary-nav"[\s\S]*?<\/nav>/,
    )?.[0];

    expect(navigation).toBeDefined();
    expect(navigation?.match(/aria-haspopup="dialog"/g)).toHaveLength(7);
    for (const label of [
      "廣告",
      "補貨",
      "文案",
      "圖片",
      "變體規劃",
      "定價",
      "促銷",
    ]) {
      expect(navigation).toContain(label);
    }

    expect(markup).toContain('class="workspace-header"');
    expect(markup).toContain('class="workspace-contextbar"');
    expect(markup.indexOf('class="workspace-header"')).toBeLessThan(
      markup.indexOf('id="workspace-top"'),
    );
    expect(markup).toContain("跳到主要內容");
    expect(markup).not.toContain("workspace-sidebar");
    expect(markup).not.toContain("mobile-core-nav");
    expect(markup).not.toContain("<aside");
    expect(markup).toContain('class="content-audit-home-card"');
    expect(markup).toContain("全站內容健檢");
    expect(markup).toContain("開始全站健檢");
  });

  it("keeps the header centered and makes the tool row horizontally reachable", async () => {
    const css = await readFile(
      new URL("../src/renderer/src/app.css", import.meta.url),
      "utf8",
    );

    expect(css).toMatch(
      /\.workspace-header\s*\{[\s\S]*?position:\s*sticky;/,
    );
    expect(css).toMatch(
      /\.workspace-header-main\s*\{[\s\S]*?margin:\s*0 auto;/,
    );
    expect(css).toMatch(
      /\.workspace-primary-nav\s*\{[\s\S]*?overflow-x:\s*auto;/,
    );
    expect(css).toMatch(
      /@media \(max-width: 1180px\)[\s\S]*?scroll-snap-type:\s*x proximity;/,
    );
    expect(css).not.toContain(".workspace-sidebar");
    expect(css).not.toContain(".mobile-core-nav");
    expect(css).not.toContain("margin-left: 244px");
  });
});
