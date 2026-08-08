import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ReplenishmentDrawer from "../src/renderer/src/components/replenishment-drawer";
import SkuCommandCenter, {
  employeeVisibleCommandTasks,
} from "../src/renderer/src/components/sku-command-center";
import SystemHealthControl from "../src/renderer/src/components/system-health-control";

describe("dashboard experience refinement", () => {
  it("presents system health as neutral advanced information", () => {
    const markup = renderToStaticMarkup(
      <SystemHealthControl marketplaceId="ATVPDKIKX0DER" />,
    );

    expect(markup).toContain("系統資訊");
    expect(markup).toContain("進階");
    expect(markup).not.toContain("有待處理");
    expect(markup).not.toContain("系統自檢與除錯");
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
  });
});
