import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PromotionCenterDrawer from "../src/renderer/src/components/promotion-center-drawer";

const SUBSCRIPTION_DEFINITION =
  "「目前有效訂閱」是 Amazon listOffers 的查詢快照，不是期間新增、歷史累計、配送次數或唯一顧客數。";

describe("renderer commerce terminology", () => {
  it("identifies Sale Price and its exact Seller Central location", () => {
    const markup = renderToStaticMarkup(
      <PromotionCenterDrawer
        initialMarketplaceId="ATVPDKIKX0DER"
        initialSellerSku=""
        onClose={() => undefined}
      />,
    );

    expect(markup).toContain("Sale Price 與 Coupon");
    expect(markup).toContain("Sale Price（SKU 限時售價）");
    expect(markup).toContain(
      "產品 → 管理所有庫存 → 編輯此 SKU → Offer／商品報價 → Sale Price",
    );
    expect(markup).toContain("不是「廣告」選單中的促銷");
    expect(markup).toContain("價格折扣、管理促銷、Deals 或 Coupon");
  });

  it("defines subscription counts consistently and formats them as counts", async () => {
    const [promotionSource, priceSource, commandSource] = await Promise.all([
      readFile(
        new URL(
          "../src/renderer/src/components/promotion-center-drawer.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "../src/renderer/src/components/price-drawer.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "../src/renderer/src/components/sku-command-center.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
    ]);

    expect(promotionSource).toContain(SUBSCRIPTION_DEFINITION);
    expect(priceSource).toContain(SUBSCRIPTION_DEFINITION);
    expect(commandSource).toContain(SUBSCRIPTION_DEFINITION);
    expect(promotionSource).toContain("<dt>目前有效訂閱</dt>");
    expect(priceSource).toContain("<dt>目前有效訂閱</dt>");
    expect(commandSource).toContain("目前有效訂閱 ${formatCount");
    for (const source of [promotionSource, priceSource, commandSource]) {
      expect(source).toContain('new Intl.NumberFormat("zh-TW"');
    }
  });

  it("names the dashboard tile without implying an Advertising promotion", async () => {
    const dashboardSource = await readFile(
      new URL("../src/renderer/src/components/dashboard.tsx", import.meta.url),
      "utf8",
    );

    expect(dashboardSource).toContain("<h3>Sale Price 與 Coupon</h3>");
    expect(dashboardSource).toContain(
      "Sale Price 對應單一 SKU 的限時售價，不是廣告選單的價格折扣或管理促銷",
    );
  });
});
