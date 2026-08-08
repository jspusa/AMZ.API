import { describe, expect, it } from "vitest";
import {
  buildBrandSalesSnapshot,
  classifyListingBrand,
  parseCurrentFbaListingTitles,
  parseFbaShipmentSalesReport,
} from "../src/main/amazon/brand-sales";

describe("FBA brand sales", () => {
  it("reads only FBA listing titles and rejects a missing fulfillment column", () => {
    const listings = parseCurrentFbaListingTitles(
      [
        "item-name\tseller-sku\tasin1\tfulfillment-channel",
        "Afreschi Treats\tAFA01\tB000000001\tAMAZON_NA",
        "GooToE Treats\tGTC01\tB000000002\tAFN",
        "\tUNTITLED\tB000000004\tAMAZON",
        "FBM Treats\tMFN01\tB000000003\tDEFAULT",
      ].join("\n"),
    );
    expect(listings).toEqual([
      { sellerSku: "AFA01", title: "Afreschi Treats" },
      { sellerSku: "GTC01", title: "GooToE Treats" },
      { sellerSku: "UNTITLED", title: "" },
    ]);
    expect(() =>
      parseCurrentFbaListingTitles("item-name\tseller-sku\nA\tSKU"),
    ).toThrow(/履約管道/u);
  });

  it("parses official FBA shipment rows without accepting malformed money", () => {
    const report = [
      "shipment-date\tsku\tquantity\tcurrency\titem-price-per-unit",
      "2026-08-08T13:00:00Z\tAFA01\t2\tUSD\t17.99",
    ].join("\n");
    expect(parseFbaShipmentSalesReport(report)).toEqual([
      {
        shipmentDate: "2026-08-08T13:00:00Z",
        sellerSku: "AFA01",
        quantity: 2,
        currencyCode: "USD",
        unitPrice: 17.99,
      },
    ]);
    expect(() =>
      parseFbaShipmentSalesReport(report.replace("17.99", "USD 17.99")),
    ).toThrow(/單件商品售價/u);
  });

  it("never trims or aliases Seller SKU evidence before joining brand sales", () => {
    expect(() =>
      parseCurrentFbaListingTitles(
        [
          "item-name\tseller-sku\tfulfillment-channel",
          "Afreschi Treats\t AFA01\tAMAZON",
        ].join("\n"),
      ),
    ).toThrow(/無法安全辨識/u);
    expect(() =>
      parseCurrentFbaListingTitles(
        [
          "item-name\tseller-sku\tfulfillment-channel",
          "Afreschi Treats\tAFA01\tAMAZON",
          "Afreschi Treats duplicate\tAFA01\tAMAZON",
        ].join("\n"),
      ),
    ).toThrow(/重複/u);
    expect(() =>
      parseFbaShipmentSalesReport(
        [
          "shipment-date\tsku\tquantity\tcurrency\titem-price-per-unit",
          "2026-08-08T13:00:00Z\tAFA01 \t2\tUSD\t17.99",
        ].join("\n"),
      ),
    ).toThrow(/無法安全辨識/u);
  });

  it("uses exact brand phrases and leaves ambiguous titles unclassified", () => {
    expect(classifyListingBrand("A Freschi srl Turkey Tendons")).toBe("afreschi");
    expect(classifyListingBrand("GooToE Chicken Jerky")).toBe("gootoe");
    expect(classifyListingBrand("HERZ soft treats")).toBe("herz");
    expect(classifyListingBrand("Healthy Moment Daily Treat")).toBe("healthy-moment");
    expect(classifyListingBrand("GooToE + Herz bundle")).toBe("unclassified");
    expect(classifyListingBrand("Herzlich natural treats")).toBe("unclassified");
  });

  it("groups proven current-FBA shipped sales in integer minor units", () => {
    const snapshot = buildBrandSalesSnapshot({
      mode: "demo",
      marketplaceId: "ATVPDKIKX0DER",
      startDate: "2026-08-01",
      endDate: "2026-08-08",
      currencyCode: "USD",
      fetchedAt: "2026-08-09T00:00:00.000Z",
      listings: [
        { sellerSku: "AFA01", title: "Afreschi Treats" },
        { sellerSku: "AFA02", title: "A Freschi srl Tendons" },
        { sellerSku: "GTC01", title: "GooToE Treats" },
        { sellerSku: "UNKNOWN01", title: "House Brand" },
      ],
      sales: [
        { shipmentDate: "2026-08-02T00:00:00Z", sellerSku: "AFA01", quantity: 3, unitPrice: 0.1, currencyCode: "USD" },
        { shipmentDate: "2026-08-03T00:00:00Z", sellerSku: "AFA02", quantity: 1, unitPrice: 17.99, currencyCode: "USD" },
        { shipmentDate: "2026-08-04T00:00:00Z", sellerSku: "GTC01", quantity: 2, unitPrice: 10, currencyCode: "USD" },
        { shipmentDate: "2026-08-05T00:00:00Z", sellerSku: "UNKNOWN01", quantity: 1, unitPrice: 5, currencyCode: "USD" },
        { shipmentDate: "2026-08-06T00:00:00Z", sellerSku: "OLD-FBM", quantity: 99, unitPrice: 99, currencyCode: "USD" },
      ],
    });

    expect(snapshot.summary).toEqual({
      amount: 9844.29,
      unitCount: 106,
      classifiedAmount: 38.29,
      unclassifiedAmount: 9806,
      currentFbaSkuCount: 4,
      soldFbaSkuCount: 5,
      soldCurrentFbaSkuCount: 4,
      unmatchedCurrentFbaRowCount: 1,
    });
    expect(snapshot.segments.find((segment) => segment.key === "afreschi")).toMatchObject({
      amount: 18.29,
      skuCount: 2,
      unitCount: 4,
    });
    expect(snapshot.segments.find((segment) => segment.key === "gootoe")).toMatchObject({
      amount: 20,
      color: "#ED8936",
    });
    expect(snapshot.segments.map((segment) => segment.color)).toEqual([
      "#2F855A",
      "#ED8936",
      "#3182CE",
      "#ECC94B",
      "#E53E3E",
      "#A0A7B1",
    ]);
  });

  it("refuses mixed marketplace currencies", () => {
    expect(() =>
      buildBrandSalesSnapshot({
        mode: "live",
        marketplaceId: "ATVPDKIKX0DER",
        startDate: "2026-08-01",
        endDate: "2026-08-08",
        currencyCode: "USD",
        listings: [{ sellerSku: "AFA01", title: "Afreschi" }],
        sales: [{ shipmentDate: "2026-08-02", sellerSku: "AFA01", quantity: 1, unitPrice: 10, currencyCode: "CAD" }],
      }),
    ).toThrow(/幣別/u);
  });
});
