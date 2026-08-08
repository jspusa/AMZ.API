import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  createAgedInventoryWorkbook,
  createListingsWorkbook,
} from "../src/main/amazon/xlsx";

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

describe("FBA aged inventory Excel export", () => {
  it("exports every selected age and AIS bucket as numeric cells plus the expiration boundary", () => {
    const workbook = createAgedInventoryWorkbook({
      marketplaceLabel: "US · Amazon.com",
      fetchedAt: "2026-08-08T00:00:00.000Z",
      excessAvailability: "complete",
      storageCostAvailability: "complete",
      agedSurchargeAvailability: "complete",
      expirationNotice:
        "Amazon 公開 API 不提供目前 FC 批次的逐 SKU 到期日。",
      rows: [
        {
          sellerSku: "AGED-FBA-01",
          fnSku: "X001AGED01",
          asin: "B0AGED0001",
          title: "Aged FBA product",
          condition: "New",
          available: 240,
          totalAgedUnits: 240,
          agedOver180: 108,
          ageBuckets: [
            { key: "0-90", label: "0–90 天", units: 80 },
            { key: "91-180", label: "91–180 天", units: 52 },
            { key: "181-270", label: "181–270 天", units: 60 },
            { key: "271-365", label: "271–365 天", units: 36 },
            { key: "366-455", label: "366–455 天", units: 12 },
            { key: "456-plus", label: "456 天以上", units: 0 },
          ],
          estimatedExcessQuantity: 82,
          recommendedRemovalQuantity: 18,
          daysOfSupply: 216.5,
          currencyCode: "USD",
          estimatedStorageCostNextMonth: 27.35,
          estimatedAgedSurcharge: 9.5,
          agedSurchargeBuckets: [
            {
              key: "181-210",
              label: "AIS 181–210 天",
              quantity: 30,
              estimatedCharge: 3.25,
            },
            {
              key: "456-plus",
              label: "AIS 456 天以上",
              quantity: 2,
              estimatedCharge: 6.25,
            },
          ],
          alert: "Amazon raw alert",
          recommendedAction: "Create sale",
          snapshotDate: "2026-08-07",
        },
      ],
    });

    expect(Array.from(workbook.slice(0, 2))).toEqual([0x50, 0x4b]);
    const archive = unzipSync(workbook);
    const workbookXml = new TextDecoder().decode(archive["xl/workbook.xml"]);
    const inventorySheet = new TextDecoder().decode(
      archive["xl/worksheets/sheet1.xml"],
    );
    const notesSheet = new TextDecoder().decode(
      archive["xl/worksheets/sheet2.xml"],
    );

    expect(workbookXml).toContain("FBA 庫齡");
    expect(workbookXml).toContain("欄位與能力邊界");
    expect(inventorySheet).toContain("AGED-FBA-01");
    expect(inventorySheet).toContain("0–90 天");
    expect(inventorySheet).toContain("456 天以上");
    expect(inventorySheet).toContain("AIS 456 天以上預估附加費");
    expect(inventorySheet).toContain("<v>27.35</v>");
    expect(inventorySheet).toContain("<v>9.5</v>");
    expect(notesSheet).toContain("GET_FBA_INVENTORY_PLANNING_DATA");
    expect(notesSheet).toContain(
      "https://developer-docs.amazon.com/sp-api/lang-en_EN/docs/report-type-values-fba",
    );
    expect(notesSheet).toContain(
      "Amazon 公開 API 不提供目前 FC 批次的逐 SKU 到期日。",
    );
    expect(notesSheet).toContain("不猜費率");
  });
});
