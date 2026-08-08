import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ReplenishmentDrawer from "../src/renderer/src/components/replenishment-drawer";
import SkuCommandCenter, {
  employeeVisibleCommandTasks,
} from "../src/renderer/src/components/sku-command-center";
import SystemHealthControl from "../src/renderer/src/components/system-health-control";
import BrandGlyph from "../src/renderer/src/components/brand-glyph";

describe("dashboard experience refinement", () => {
  it("presents system health as neutral advanced information", () => {
    const markup = renderToStaticMarkup(
      <SystemHealthControl marketplaceId="ATVPDKIKX0DER" />,
    );

    expect(markup).toContain("系統資訊");
    expect(markup).toContain("進階");
    expect(markup).not.toContain("有待處理");
    expect(markup).not.toContain("系統自檢與除錯");
    expect(markup).not.toContain("自動分析私密資料");
  });

  it("moves display and advanced workspace preferences into system information", async () => {
    const markup = renderToStaticMarkup(
      <SystemHealthControl
        marketplaceId="ATVPDKIKX0DER"
        autoSync={false}
        onAutoSyncChange={() => undefined}
      />,
    );
    const source = await readFile(
      new URL(
        "../src/renderer/src/components/system-health-control.tsx",
        import.meta.url,
      ),
      "utf8",
    );

    expect(source).toContain("操作偏好與系統說明");
    expect(source).toContain("銷售趨勢自動同步");
    expect(source).toContain("Mac Keychain Secrets");
    expect(source).toContain("API 版本更新建議");
    expect(source).toContain("下次功能靈感");
    expect(source).toContain("不會讀取或分析 SKU、銷售、憑證等私密資料");
    expect(source).toContain("FEATURE_IDEAS");
    expect(source).not.toContain("AccountingCenterPanel");
    expect(markup).not.toContain("FBA 帳務中心");
  });

  it("uses the top Amazon status as the only Mac connection entry", async () => {
    const [appSource, connectionSource, dashboardSource] = await Promise.all([
      readFile(new URL("../src/renderer/src/App.tsx", import.meta.url), "utf8"),
      readFile(
        new URL("../src/renderer/src/connection-panel.tsx", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../src/renderer/src/components/dashboard.tsx", import.meta.url),
        "utf8",
      ),
    ]);

    expect(appSource).toContain("showTrigger={false}");
    expect(appSource).toContain("onOpenConnection={() => setConnectionOpen(true)}");
    expect(connectionSource).toContain("{showTrigger && (");
    expect(dashboardSource).toContain("開啟 Mac 安全連線設定");
    expect(dashboardSource).toContain("aria-haspopup=\"dialog\"");
  });

  it("keeps Product Master controls out of employee-facing drawers", async () => {
    const replenishment = renderToStaticMarkup(
      <ReplenishmentDrawer
        initialMarketplaceId="ATVPDKIKX0DER"
        onClose={() => undefined}
      />,
    );
    const command = renderToStaticMarkup(
      <SkuCommandCenter
        initialMarketplaceId="ATVPDKIKX0DER"
        onLaunch={() => undefined}
        onClose={() => undefined}
      />,
    );

    for (const markup of [replenishment, command]) {
      expect(markup).not.toContain("PRODUCT MASTER");
      expect(markup).not.toContain("商品主檔與補貨預設");
      expect(markup).not.toContain("儲存為此 SKU 預設");
    }

    const healthSource = await readFile(
      new URL(
        "../src/renderer/src/components/system-health-control.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    expect(healthSource).toContain('item.id !== "product-master"');
    expect(
      employeeVisibleCommandTasks([{ id: "profile-settings" }]),
    ).toEqual([]);
    expect(
      employeeVisibleCommandTasks([
        { id: "profile-settings" },
        { id: "content-missing" },
      ]),
    ).toEqual([{ id: "content-missing" }]);

    const commandSource = await readFile(
      new URL(
        "../src/renderer/src/components/sku-command-center.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    expect(commandSource).toContain("const visibleTasks = snapshot");
    expect(commandSource).toContain("目前沒有明顯異常");
  });

  it("uses the blue J icon with a red bottom arrow", async () => {
    const [appIcon, launcherIcon] = await Promise.all([
      readFile(new URL("../build/icon.svg", import.meta.url), "utf8"),
      readFile(new URL("../launcher/icon.svg", import.meta.url), "utf8"),
    ]);

    expect(appIcon).toBe(launcherIcon);
    expect(appIcon).toContain('stroke="#e32636"');
    expect(appIcon).toContain('M76 34h13');
    expect(appIcon).not.toContain('stroke="#ff9d19"');
    expect(appIcon).not.toContain('M41 84 60.5 34');

    const rendererMark = renderToStaticMarkup(
      <BrandGlyph className="test-brand-mark" />,
    );
    expect(rendererMark).toContain('viewBox="28 23 76 84"');
    expect(rendererMark).toContain('transform="translate(-3 -3)"');
    expect(rendererMark.match(/stroke="#e32636"/g)).toHaveLength(2);
  });
});
