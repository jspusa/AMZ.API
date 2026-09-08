import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Dashboard, {
  DEFAULT_MARKETPLACE_ID,
} from "../src/renderer/src/components/dashboard";

describe("minimal FBA workspace", () => {
  it("shows only operational labels, states, and actions on the unrun home screen", () => {
    const markup = renderToStaticMarkup(
      <Dashboard
        initialSalesTrend={null}
        initialMarketplaceId={DEFAULT_MARKETPLACE_ID}
      />,
    );

    for (const redundantCopy of [
      "JASPER / FBA WORKSPACE",
      "營運工作台",
      "銷售表現、重要日程與商品健檢，在同一處掌握。",
      "Jasper 的工作區",
      "OPERATIONS PULSE",
      "CATALOG HEALTH",
      "選擇單項，或一次完成 7 項一鍵健檢。",
      "直接啟動下方 7 張單項卡片",
      "按項目查看",
      "同次 App 使用期間保留結果",
      "按需啟動 · 唯讀健檢",
      "即期品倒數與 Amazon 促銷檔期",
      "OPERATING SIGNALS",
      "僅在 Notebook Key 開啟時同步",
      "尚未同步；不代表沒有活動、庫存或問題。",
      "Jasper 營運工作區",
    ]) {
      expect(markup).not.toContain(redundantCopy);
    }

    expect(markup).toContain("AMZ.API");
    expect(markup).toContain("商品健檢");
    expect(markup.match(/data-audit-workspace-launch=/g)).toHaveLength(7);
    expect(markup).toContain(">全部執行<");
    expect(markup).toContain(">設定<");
    expect(markup).not.toContain("workspace-avatar");
    expect(markup).toContain('<h1 id="workspace-title" class="visually-hidden">');
    expect(markup).toContain('class="operations-intelligence-disclosure"');
    expect(markup).not.toContain('class="operations-intelligence-disclosure" open=""');
    expect(markup).toContain(">營運情報<");
  });
});
