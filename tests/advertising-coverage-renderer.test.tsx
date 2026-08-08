import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseAdvertisingCoverageSnapshot } from "../src/renderer/src/advertising-coverage";
import AdvertisingCoveragePanel from "../src/renderer/src/components/advertising-coverage-panel";

function snapshot() {
  const rows = [
    {
      sellerSku: "AFA01",
      asin: "B000000001",
      title: "Afreschi",
      covered: true,
      evidence: {
        kind: "seller-sku",
        campaignId: "c1",
        campaignName: "[ProductAI] US-B000000001-AFA01-SP-PAT-Aug92026",
        campaignSellerSku: "AFA01",
      },
    },
    {
      sellerSku: "GTC01",
      asin: "B000000002",
      title: "GooToE",
      covered: false,
      evidence: null,
    },
  ];
  return {
    schemaVersion: 1,
    mode: "demo",
    marketplaceId: "ATVPDKIKX0DER",
    marketplaceCode: "US",
    fetchedAt: "2026-08-09T00:00:00.000Z",
    rows,
    uncovered: [rows[1]],
    summary: {
      currentFbaSkuCount: 2,
      coveredSkuCount: 1,
      directSkuCount: 1,
      sameAsinCount: 0,
      uncoveredSkuCount: 1,
      eligibleCampaignCount: 1,
      ignoredInactiveCampaignCount: 0,
      ignoredMalformedCampaignCount: 0,
    },
    rule: "只計 ENABLED SP。",
    notice: "唯讀。",
  };
}

describe("advertising coverage renderer", () => {
  it("accepts exact current marketplace data and rejects inconsistent uncovered totals", () => {
    expect(parseAdvertisingCoverageSnapshot(snapshot(), "ATVPDKIKX0DER").uncovered[0]?.sellerSku).toBe("GTC01");
    const tamperedDuplicate = {
      ...snapshot(),
      uncovered: [{ ...snapshot().uncovered[0], title: "untrusted duplicate title" }],
    };
    expect(
      parseAdvertisingCoverageSnapshot(tamperedDuplicate, "ATVPDKIKX0DER")
        .uncovered[0]?.title,
    ).toBe("GooToE");
    expect(() => parseAdvertisingCoverageSnapshot(snapshot(), "A2EUQ1WTGCTBG2")).toThrow(/安全辨識/u);
    expect(() => parseAdvertisingCoverageSnapshot({ ...snapshot(), uncovered: [] }, "ATVPDKIKX0DER")).toThrow(/加總/u);
  });

  it("renders the disconnected state honestly without exposing credential fields", () => {
    const html = renderToStaticMarkup(
      <AdvertisingCoveragePanel marketplaceId="ATVPDKIKX0DER" available={false} unavailableNotice="Amazon Ads API 尚未連線。" />,
    );
    expect(html).toContain("全站廣告覆蓋健檢");
    expect(html).toContain("功能已備妥，等待 Ads API");
    expect(html).toContain("ProductAI");
    expect(html).toContain("disabled");
    expect(html).not.toMatch(/client secret|refresh token|seller id/iu);
  });
});
