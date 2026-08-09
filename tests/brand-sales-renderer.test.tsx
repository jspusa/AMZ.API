import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseBrandSalesSnapshot } from "../src/renderer/src/brand-sales";
import BrandSalesChart, {
  brandSalesPiePath,
  sortBrandSalesSegments,
} from "../src/renderer/src/components/brand-sales-chart";

const expected = {
  marketplaceId: "ATVPDKIKX0DER",
  startDate: "2026-08-01",
  endDate: "2026-08-07",
};

function snapshot() {
  return {
    schemaVersion: 1,
    mode: "demo",
    ...expected,
    fetchedAt: "2026-08-08T00:00:00.000Z",
    currencyCode: "USD",
    segments: [
      { key: "afreschi", label: "Afreschi", color: "#2F855A", amount: 50, percentage: 50, skuCount: 2, unitCount: 5 },
      { key: "gootoe", label: "GooToE", color: "#ED8936", amount: 25, percentage: 25, skuCount: 1, unitCount: 2 },
      { key: "herz", label: "Herz", color: "#3182CE", amount: 10, percentage: 10, skuCount: 1, unitCount: 1 },
      { key: "vitaday", label: "Vitaday", color: "#ECC94B", amount: 5, percentage: 5, skuCount: 1, unitCount: 1 },
      { key: "healthy-moment", label: "Healthy Moment", color: "#E53E3E", amount: 5, percentage: 5, skuCount: 1, unitCount: 1 },
      { key: "unclassified", label: "未分類", color: "#A0A7B1", amount: 5, percentage: 5, skuCount: 1, unitCount: 1 },
    ],
    summary: {
      amount: 100,
      unitCount: 11,
      classifiedAmount: 95,
      unclassifiedAmount: 5,
      currentFbaSkuCount: 8,
      soldFbaSkuCount: 7,
      soldCurrentFbaSkuCount: 7,
      unmatchedCurrentFbaRowCount: 0,
    },
    source: "FBA_CUSTOMER_SHIPMENT_SALES_REPORT",
    notice: "只含 FBA 已出貨商品。",
  };
}

describe("brand sales renderer", () => {
  it("accepts exact marketplace and range while rejecting altered totals or colors", () => {
    expect(parseBrandSalesSnapshot(snapshot(), expected).summary.amount).toBe(100);
    expect(() => parseBrandSalesSnapshot({ ...snapshot(), marketplaceId: "A2EUQ1WTGCTBG2" }, expected)).toThrow(/安全辨識/u);
    expect(() => parseBrandSalesSnapshot({ ...snapshot(), summary: { ...snapshot().summary, amount: 99 } }, expected)).toThrow(/加總/u);
    expect(() => parseBrandSalesSnapshot({ ...snapshot(), segments: snapshot().segments.map((segment, index) => index === 0 ? { ...segment, color: "#000000" } : segment) }, expected)).toThrow(/安全辨識/u);
    expect(() => parseBrandSalesSnapshot({ ...snapshot(), segments: snapshot().segments.map((segment, index) => index === 0 ? { ...segment, percentage: 99 } : segment) }, expected)).toThrow(/加總/u);
    expect(() => parseBrandSalesSnapshot({ ...snapshot(), summary: { ...snapshot().summary, soldFbaSkuCount: 8 } }, expected)).toThrow(/加總/u);
  });

  it("renders a keyboard-accessible solid pie with no inner cover", () => {
    const parsed = parseBrandSalesSnapshot(snapshot(), expected);
    const html = renderToStaticMarkup(
      <BrandSalesChart snapshot={parsed} loading={false} error={null} rangeLabel="08/01–08/07" onRetry={() => undefined} />,
    );
    expect(html).toContain("品牌營收占比");
    expect(html).toContain("Afreschi");
    expect(html).toContain("GooToE");
    expect(html).toContain("Healthy Moment");
    for (const color of ["#2F855A", "#ED8936", "#3182CE", "#ECC94B", "#E53E3E", "#A0A7B1"]) {
      expect(html).toContain(color);
    }
    expect(html).toContain("tabindex=\"0\"");
    expect(html.match(/class="brand-sales-pie-slice/g)).toHaveLength(6);
    expect(html.match(/d="M 60 60 L/g)).toHaveLength(6);
    expect(html).toContain("<title>Afreschi");
    expect(html).not.toContain("brand-sales-center");
    expect(html).not.toContain("brand-sales-donut");
    expect(html).toContain("50%");
    expect(html).toContain("已隨區間自動更新");
    expect(html).toContain("<details class=\"brand-sales-notice\">");
    expect(html).toContain("<summary>資料怎麼算</summary>");
    expect(html).toContain("只含 FBA 已出貨商品。");
    expect(html).not.toContain("同步品牌");
    expect(html).not.toContain("重新同步");
  });

  it("builds wedges from the center and closes a full solid circle", () => {
    expect(brandSalesPiePath(0, 0.25)).toBe(
      "M 60 60 L 60 8 A 52 52 0 0 1 112 60 Z",
    );
    const full = brandSalesPiePath(0, 1);
    expect(full).toMatch(/^M 60 60 L 60 8 /u);
    expect(full.match(/A 52 52 0 1 1/g)).toHaveLength(2);
    expect(full.endsWith(" Z")).toBe(true);
    expect(brandSalesPiePath(0, 0)).toBe("");
  });

  it("orders revenue high to low and keeps equal and zero rows stable", () => {
    const parsed = parseBrandSalesSnapshot(snapshot(), expected);
    const [afreschi, gootoe, herz, vitaday, healthyMoment, unclassified] = parsed.segments;
    const ordered = sortBrandSalesSegments([
      { ...afreschi, amount: 0 },
      { ...gootoe, amount: 25 },
      { ...herz, amount: 5 },
      { ...vitaday, amount: 20 },
      { ...healthyMoment, amount: 5 },
      { ...unclassified, amount: 0 },
    ]);
    expect(ordered.map(({ key }) => key)).toEqual([
      "gootoe",
      "vitaday",
      "herz",
      "healthy-moment",
      "afreschi",
      "unclassified",
    ]);

    const amounts = [10, 50, 0, 30, 10, 0];
    const percentages = [10, 50, 0, 30, 10, 0];
    const units = [1, 5, 0, 3, 1, 0];
    const validUnsorted = {
      ...snapshot(),
      segments: snapshot().segments.map((segment, index) => ({
        ...segment,
        amount: amounts[index],
        percentage: percentages[index],
        skuCount: amounts[index] > 0 ? 1 : 0,
        unitCount: units[index],
      })),
      summary: {
        ...snapshot().summary,
        amount: 100,
        unitCount: 10,
        classifiedAmount: 100,
        unclassifiedAmount: 0,
        soldFbaSkuCount: 4,
        soldCurrentFbaSkuCount: 4,
      },
    };
    const html = renderToStaticMarkup(
      <BrandSalesChart
        snapshot={parseBrandSalesSnapshot(validUnsorted, expected)}
        loading={false}
        error={null}
        rangeLabel="08/01–08/07"
        onRetry={() => undefined}
      />,
    );
    const legend = html.slice(html.indexOf('class="brand-sales-legend"'));
    const labels = ["GooToE", "Vitaday", "Afreschi", "Healthy Moment", "Herz", "未分類"];
    for (let index = 1; index < labels.length; index += 1) {
      expect(legend.indexOf(labels[index - 1])).toBeLessThan(legend.indexOf(labels[index]));
    }
  });

  it("shows cancelled reports honestly and exposes only an explicit quiet retry", () => {
    const html = renderToStaticMarkup(
      <BrandSalesChart
        snapshot={null}
        loading={false}
        error={{
          code: "REPORT_CANCELLED",
          message: "Amazon 已取消這次 FBA 出貨報表；沒有資料被修改。",
          requestId: "request-brand-1234",
        }}
        rangeLabel="08/01–08/07"
        onRetry={() => undefined}
      />,
    );
    expect(html).toContain("Amazon 已取消這次報表");
    expect(html).toContain("沒有資料被修改");
    expect(html).toContain("Request ID: request-brand-1234");
    expect(html).toContain(">再試一次</button>");
  });
});
