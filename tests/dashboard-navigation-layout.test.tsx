import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Dashboard, {
  DEFAULT_MARKETPLACE_ID,
  businessPricingAttentionCount,
} from "../src/renderer/src/components/dashboard";

describe("dashboard top navigation layout", () => {
  it("counts each B2B attention row once when recommendation categories overlap", () => {
    const attentionRow = {
      sellerSku: "BOTH-MISMATCH",
      asin: "B000000001",
      title: "Both recommendation issues",
      productType: "PET_FOOD",
      standardPrice: { amount: 20, currencyCode: "USD" },
      businessPrice: { amount: 17, currencyCode: "USD" },
      businessOfferPresence: "present" as const,
      quantityDiscountPlan: null,
      quantityDiscountPlanPresence: "absent" as const,
      recommendedPriceMismatch: true,
      recommendedQuantityDiscountMismatch: true,
      status: "configured" as const,
      editable: false,
      reason: "同時不符兩項建議。",
    };
    expect(businessPricingAttentionCount({
      mode: "live",
      marketplaceId: "ATVPDKIKX0DER",
      fetchedAt: "2026-08-23T10:00:00.000Z",
      rows: [attentionRow, {
        ...attentionRow,
        sellerSku: "EXACT-GOOD",
        asin: "B000000002",
        recommendedPriceMismatch: false,
        recommendedQuantityDiscountMismatch: false,
        reason: "符合建議。",
      }],
      summary: {
        totalFbaSkuCount: 2,
        configured: 2,
        aboveStandard: 0,
        missing: 0,
        unsupported: 0,
        incomplete: 0,
        recommendedPriceMismatch: 1,
        recommendedQuantityDiscountMismatch: 1,
      },
      notice: "FBA-only fixture。",
    })).toBe(1);
  });

  it("groups workspaces and injectable reports into four centered dropdowns and removes home tool tiles", async () => {
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
    expect(navigation?.match(/aria-haspopup="menu"/g)).toHaveLength(4);
    expect(navigation?.match(/workspace-primary-menu-chevron/g)).toHaveLength(4);
    expect(navigation).not.toContain("⌄");
    const orderedLabels = [
      "產品區",
      "價格區",
      "營運區",
      "報表區",
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
    expect(markup).toContain("近期營運");
    expect(markup).toContain("一鍵健檢");
    expect(markup).not.toContain('class="inbound-home-card"');
    expect(markup).not.toContain("FBA 入庫貨件追蹤捷徑");
    expect(markup).toContain('class="content-audit-home-card"');
    expect(markup).toContain("全站文案健檢");
    expect(markup).toContain("開始全站文案健檢");
    expect(markup).toContain('class="health-audit-home-grid"');
    expect(markup).toContain('class="content-audit-home-card image-audit-home-card"');
    expect(markup).toContain("全站圖片健檢");
    expect(markup).toContain("開始全站圖片健檢");
    expect(markup).toContain("全站 A+ 健檢");
    expect(markup).toContain("開始全站 A+ 健檢");
    expect(markup).toContain("逐一核對全部 FBA ASIN 是否有官方 A+ 發布紀錄");
    expect(markup).not.toContain("From the brand");
    expect(markup).not.toContain("Brand Story");
    expect(markup).toContain('<details class="low-frequency-audits">');
    expect(markup).not.toContain('<details class="low-frequency-audits" open=""');
    expect(markup).toContain("低頻健檢");
    expect(markup).toContain("庫齡與評論不會跟著 7 項一鍵健檢自動執行");
    expect(markup).not.toContain("庫齡與評論不會跟著五項一鍵健檢自動執行");
    expect(markup).toContain("FBA 180 天以上庫齡健檢");
    expect(markup).toContain("主清單只列已經超過 180 天的 FBA 庫存");
    expect(markup).toContain("estimated excess 預估與費用放在獨立分頁");
    expect(markup).not.toContain("FBA 庫齡、冗餘與官方預估費用");
    expect(markup).toContain("廣告覆蓋健檢");
    expect(markup).toContain("未綁變體健檢");
    expect(markup).toContain("開始未綁變體健檢");
    expect(markup).toContain("查看健檢能力與連線");
    expect(markup).toContain("Amazon Ads API 尚未連線前不顯示推測結果");
    expect(markup).toContain("全站訂閱價格健檢");
    expect(markup).toContain("開始全站訂閱價格健檢");
    expect(markup).toContain("全站 B2B 價格健檢");
    expect(markup).toContain("開始全站 B2B 價格健檢");
    expect(markup).toContain("評論健檢");
    expect(markup).toContain("Listings relationships 已證明的 child 與 standalone ASIN");
    expect(markup).toContain("開始全站評論健檢");
    expect(markup).not.toContain("全站內容健檢");
    expect(markup).not.toContain('id="product-zone"');
    expect(markup).not.toContain('id="pricing-zone"');
    expect(markup).not.toContain('id="planning-zone"');
    expect(markup).not.toContain("FBA OPERATING SYSTEM");
    expect(markup).not.toContain("今天想從哪裡開始");
    expect(markup).not.toContain('class="automation-overview"');
    expect(markup).not.toContain('class="command-strip"');
    expect(markup).not.toContain("進階功能與系統說明");
    expect(markup).not.toContain("Amazon 已連線");
    expect(markup).toContain("本機安全連線");

    const lowFrequencyStart = markup.indexOf('class="low-frequency-audits"');
    const auditGrid = markup.slice(
      markup.indexOf('class="health-audit-home-grid"'),
      lowFrequencyStart,
    );
    const orderedAuditCards = [
      "全站文案健檢",
      "全站圖片健檢",
      "全站 A+ 健檢",
      "未綁變體健檢",
      "全站訂閱價格健檢",
      "全站 B2B 價格健檢",
      "廣告覆蓋健檢",
    ];
    for (let index = 1; index < orderedAuditCards.length; index += 1) {
      expect(auditGrid.indexOf(orderedAuditCards[index - 1])).toBeLessThan(
        auditGrid.indexOf(orderedAuditCards[index]),
      );
    }
    expect(auditGrid).not.toContain("FBA 180 天以上庫齡健檢");
    expect(auditGrid).not.toContain("評論健檢");
    const lowFrequency = markup.slice(lowFrequencyStart, markup.indexOf("</details>", lowFrequencyStart));
    expect(lowFrequency.indexOf("FBA 180 天以上庫齡健檢")).toBeLessThan(
      lowFrequency.indexOf("評論健檢"),
    );

    const source = await readFile(
      new URL("../src/renderer/src/components/dashboard.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("AUDIT_SUITE_SECTION_LABELS");
    for (const id of [
      "content",
      "image",
      "aplus",
      "variation",
      "subscription",
      "businessPricing",
      "advertising",
    ]) {
      expect(source).toContain(`<h2>{AUDIT_SUITE_SECTION_LABELS.${id}}</h2>`);
    }
    for (const label of ["文案", "圖片", "變體", "定價", "促銷", "訂閱價格健檢", "B2B 價格健檢", "補貨", "廣告", "帳務"]) {
      expect(source).toContain(`label: "${label}"`);
    }
    expect(source).toContain('role="menuitem"');
    expect(source).toContain('event.key === "ArrowDown"');
    expect(source).toContain('event.key !== "Escape"');
    expect(source).toContain("unboundVariationAuditCache");
    expect(source).toContain("onCachedResultChange={cacheUnboundVariationAudit}");
    expect(source).toContain("setUnboundVariationAuditOpen(true)");
    expect(source).toContain("setAgedInventoryOpen(true)");
    expect(source).toContain("agedInventoryOpen && createPortal");
    expect(source).toContain("reportMenuEntries");
    expect(source).toContain('label: "Amazon API 文件庫"');
    expect(source).toContain('label: "FBA 評論健檢"');
    expect(source).toContain("<ReportLibraryPanel");
    expect(source).toContain("<ReviewAuditPanel");
    expect(source).toContain("openReportExport");
    expect(source).toContain('label: "報表區"');
    expect(source).toContain('tools: ["price", "promotion", "subscriptions", "business-pricing"]');
    expect(source).toContain('tools: ["restock", "ads", "accounting"]');
    expect(source).toContain('tools: ["inbound"]');
    expect(source).toContain("section.tools.length + index");
    expect(source).toContain('.filter((entry) => entry.id !== "review-audit")');
    expect(source).toContain("查看進行中的評論健檢");
    expect(source).toContain("查看上次評論健檢");
    expect(source).toContain("<BusinessPricingAuditDrawer");
    expect(source).toContain("businessPricingAuditCache");
    expect(source).toContain("<AplusAuditDrawer");
    expect(source).toContain("aplusAuditCache");
    expect(source).toContain('tool === "a-plus" && !connectionEvidence[marketplaceId]');
    expect(source).not.toContain("繼續上次評論健檢");
    expect(source).not.toContain("繼續查看評論健檢");
    expect(source).not.toContain(">⌄</i>");
  });

  it("renders injected report entries without coupling them to a renderer tool", () => {
    const markup = renderToStaticMarkup(
      <Dashboard
        initialSalesTrend={null}
        initialMarketplaceId={DEFAULT_MARKETPLACE_ID}
        initialError="Sales API 暫時無法同步。"
        reportMenuEntries={[{
          id: "report-library",
          label: "營運報表庫",
          detail: "依站點開啟唯讀報表",
          symbol: "R",
          onSelect: () => undefined,
        }]}
      />,
    );
    const source = markup;
    expect(source).toContain("報表區");
    // The menu is interaction-rendered; the injectable contract itself is
    // exercised by TypeScript, while the placeholder keeps the closed SSR tidy.
    expect(source).not.toContain("營運報表庫");
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
    expect(css).toMatch(/\.workspace-primary-menu\s*\{[\s\S]*?position:\s*absolute;/);
    expect(css).toMatch(/\.workspace-primary-nav\s*\{[\s\S]*?overflow:\s*visible;/);
    expect(css).toMatch(/@media \(max-width: 680px\)[\s\S]*?\.workspace-primary-menu\s*\{[\s\S]*?position:\s*fixed;/);
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
      /\.health-audit-home-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/,
    );
    expect(css).toMatch(/\.low-frequency-audits\s*\{[\s\S]*?border:/);
    expect(css).toMatch(/\.low-frequency-audits\s*>\s*summary\s*\{[\s\S]*?cursor:\s*pointer;/);
    expect(css).toMatch(
      /@media \(max-width: 820px\)[\s\S]*?\.health-audit-home-grid\s*\{[\s\S]*?grid-template-columns:\s*1fr;/,
    );
    expect(css).toMatch(
      /\.image-audit-row\s*\{[\s\S]*?grid-template-columns:\s*64px minmax\(0, 1fr\) auto;/,
    );
    expect(css).toMatch(
      /@media \(max-width: 680px\)[\s\S]*?\.image-audit-row\s*\{[\s\S]*?grid-template-columns:\s*56px minmax\(0, 1fr\);/,
    );
    expect(css).toMatch(
      /\.report-library-report-list\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/,
    );
    expect(css).toMatch(
      /@media \(max-width: 680px\)[\s\S]*?\.report-library-export-grid,[\s\S]*?\.report-library-report-list,[\s\S]*?\.review-audit-rankings\s*\{[\s\S]*?grid-template-columns:\s*1fr;/,
    );
    expect(css).toMatch(
      /\.brand-sales-visual\s*\{[\s\S]*?flex-direction:\s*column;/,
    );
    expect(css).toMatch(
      /\.brand-sales-pie-wrap\s*\{[\s\S]*?width:\s*min\(100%, 184px\);/,
    );
    expect(css).toMatch(
      /\.brand-sales-legend\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/,
    );
    expect(css).toMatch(
      /\.brand-sales-legend strong,[\s\S]*?\.brand-sales-legend small\s*\{[\s\S]*?white-space:\s*normal;[\s\S]*?overflow-wrap:\s*anywhere;/,
    );
    expect(css).toMatch(
      /@media \(max-width: 430px\)[\s\S]*?\.brand-sales-card\s*\{[\s\S]*?max-width:\s*100%;/,
    );
    expect(css).toMatch(
      /\.workspace-primary-menu-chevron::after\s*\{[\s\S]*?content:\s*none;/,
    );
    expect(css).toMatch(
      /\.workspace-primary-menu-chevron::before\s*\{[\s\S]*?transform:\s*rotate\(45deg\);/,
    );
  });

  it("keeps the SG subscription menu label on the capability explanation path", async () => {
    const markup = renderToStaticMarkup(
      <Dashboard
        initialSalesTrend={null}
        initialMarketplaceId="A19VAU5U5O7RUS"
        initialError="Sales API 暫時無法同步。"
      />,
    );
    expect(markup).toContain("價格區");
    const source = await readFile(
      new URL("../src/renderer/src/components/dashboard.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain('? "S&S 能力說明"');
    expect(source).toContain("isSubscriptionAuditMarketplaceSupported");
  });
});
