import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { createListingsWorkbook } from "../src/main/amazon/xlsx";

describe("listing content Excel export", () => {
  it("creates a valid OOXML archive with five bullets and ingredients", () => {
    const workbook = createListingsWorkbook({
      marketplaceLabel: "US · Amazon.com",
      fetchedAt: "2026-08-05T00:00:00.000Z",
      rows: [
        {
          sku: "SAFE-SKU-1",
          asin: "B000000001",
          productType: "FOOD",
          title: "Sample title",
          bulletPoints: ["One", "Two", "Three", "Four", "Five"],
          ingredients: "Ingredient A, Ingredient B",
          status: "BUYABLE",
        },
      ],
    });
    expect(Array.from(workbook.slice(0, 2))).toEqual([0x50, 0x4b]);
    const archive = unzipSync(workbook);
    expect(archive["xl/workbook.xml"]).toBeDefined();
    const sheet = new TextDecoder().decode(archive["xl/worksheets/sheet1.xml"]);
    expect(sheet).toContain("SAFE-SKU-1");
    expect(sheet).toContain("Ingredient A, Ingredient B");
    expect(sheet).toContain("Five");
  });
});
