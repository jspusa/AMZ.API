import { renderToStaticMarkup } from "react-dom/server";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import Dashboard, {
  DEFAULT_MARKETPLACE_ID,
} from "../src/renderer/src/components/dashboard";

describe("operations bulletin dashboard placement", () => {
  it("places the important bulletin above the one-click FBA audit launcher", () => {
    const markup = renderToStaticMarkup(
      <Dashboard
        initialSalesTrend={null}
        initialMarketplaceId={DEFAULT_MARKETPLACE_ID}
        initialError="Sales API 暫時無法同步。"
      />,
    );

    const bulletin = markup.indexOf("營運公布欄");
    const runAll = markup.indexOf("一鍵執行全部 FBA 健檢");
    expect(bulletin).toBeGreaterThan(-1);
    expect(runAll).toBeGreaterThan(-1);
    expect(bulletin).toBeLessThan(runAll);
  });

  it("keeps the local visual harness deterministic for the board and SKU enrichment", async () => {
    const fixture = await readFile(
      new URL("../scripts/visual-qa/renderer-visual-fixture.js", import.meta.url),
      "utf8",
    );
    expect(fixture).toContain('request.path === "/api/operations-board"');
    expect(fixture).toContain('request.path === "/api/sp-api/operations-board-facts"');
    expect(fixture).not.toContain('request.path === "/api/sp-api/sku-command"');
    expect(fixture).toContain('mode: "live"');
    expect(fixture).toContain("operationsBoard:");
    expect(fixture).toContain("Visual Prime 檔期");
  });
});
