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
    expect(navigation?.match(/aria-haspopup="dialog"/g)).toHaveLength(8);
    const orderedLabels = [
      "文案",
      "圖片",
      "變體改掛",
      "定價",
      "促銷",
      "訂閱價格健檢",
      "補貨",
      "廣告",
    ];
    for (const label of orderedLabels) {
      expect(navigation).toContain(label);
    }
    for (let index = 1; index < orderedLabels.length; index += 1) {
      expect(navigation!.indexOf(orderedLabels[index - 1])).toBeLessThan(
        navigation!.indexOf(orderedLabels[index]),
      );
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
    expect(markup).toContain("全站文案健檢");
    expect(markup).toContain("開始全站文案健檢");
    expect(markup).toContain('class="health-audit-home-grid"');
    expect(markup).toContain('class="content-audit-home-card image-audit-home-card"');
    expect(markup).toContain("全站圖片健檢");
    expect(markup).toContain("開始全站圖片健檢");
    expect(markup).toContain("全站訂閱價格健檢");
    expect(markup).toContain("6／12／23 個完整月");
    expect(markup).not.toContain("全站內容健檢");
    expect(markup.indexOf('id="product-zone"')).toBeLessThan(
      markup.indexOf('id="pricing-zone"'),
    );
    expect(markup.indexOf('id="pricing-zone"')).toBeLessThan(
      markup.indexOf('id="planning-zone"'),
    );
    expect(markup).not.toContain('class="automation-overview"');
    expect(markup).not.toContain('class="command-strip"');
    expect(markup).toContain("進階功能與系統說明");
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
    expect(css).toMatch(
      /\.drawer-backdrop\s*\{[\s\S]*?align-items:\s*center;[\s\S]*?justify-content:\s*center;/,
    );
    expect(css).toMatch(
      /\.connection-panel-backdrop\s*\{[\s\S]*?align-items:\s*center;[\s\S]*?justify-content:\s*center;/,
    );
    expect(css).toMatch(
      /\.pricing-zone \.zone-tools,\s*\.planning-zone \.zone-tools\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/,
    );
    expect(css).toMatch(
      /@media \(min-width: 861px\)[\s\S]*?\.pricing-zone \.zone-tools\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/,
    );
    expect(css).toMatch(
      /\.health-audit-home-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/,
    );
    expect(css).toMatch(
      /@media \(max-width: 820px\)[\s\S]*?\.health-audit-home-grid\s*\{[\s\S]*?grid-template-columns:\s*1fr;/,
    );
    expect(css).toMatch(
      /\.image-audit-row\s*\{[\s\S]*?grid-template-columns:\s*64px minmax\(0, 1fr\) auto;/,
    );
    expect(css).toMatch(
      /@media \(max-width: 680px\)[\s\S]*?\.image-audit-row\s*\{[\s\S]*?grid-template-columns:\s*56px minmax\(0, 1fr\);/,
    );
  });

  it("does not advertise an SG subscription scan that Amazon's official API cannot run", () => {
    const markup = renderToStaticMarkup(
      <Dashboard
        initialSalesTrend={null}
        initialMarketplaceId="A19VAU5U5O7RUS"
        initialError="Sales API 暫時無法同步。"
      />,
    );
    const navigation = markup.match(
      /<nav class="workspace-primary-nav"[\s\S]*?<\/nav>/,
    )?.[0];

    expect(navigation).toContain("S&amp;S 能力說明");
    expect(navigation).not.toContain("訂閱價格健檢");
    expect(markup).toContain("Subscribe &amp; Save 能力說明");
    expect(markup).toContain("SG 站不在 Amazon 官方 Seller Replenishment API 支援清單");
    expect(markup).toContain("不會送出全站掃描");
    expect(markup).toContain("官方 API 未支援");
    expect(markup).not.toContain("核對全部 FBA S&amp;S");
    expect(markup).not.toContain("全站 FBA 自動核對");
  });
});
