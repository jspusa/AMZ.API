import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  createAgedInventoryWorkbook,
  createImageAuditWorkbook,
  createListingsWorkbook,
  createUnboundVariationWorkbook,
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
      excessReportedSkuCount: 1,
      storageCostAvailability: "complete",
      storageCostReportedSkuCount: 1,
      agedSurchargeAvailability: "complete",
      agedSurchargeReportedSkuCount: 1,
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

describe("FBA image audit Excel export", () => {
  it("keeps complete, under-minimum and incomplete rows honest in one snapshot", () => {
    const workbook = createImageAuditWorkbook({
      marketplaceId: "ATVPDKIKX0DER",
      marketplaceLabel: "US · Amazon.com",
      fetchedAt: "2026-08-08T08:00:00.000Z",
      minimumImages: 6,
      rows: [
        {
          sellerSku: "FIVE-IMAGES",
          asin: "B000000001",
          productType: "PET_FOOD",
          title: "Five images",
          imageUrls: ["https://a/1.jpg", "https://a/2.jpg", "https://a/3.jpg", "https://a/4.jpg", "https://a/5.jpg"],
          imageCount: 5,
          readStatus: "complete",
          readErrors: [],
        },
        {
          sellerSku: "UNKNOWN-IMAGES",
          asin: "B000000002",
          productType: "PET_FOOD",
          title: "Unknown images",
          imageUrls: [],
          imageCount: 0,
          readStatus: "incomplete",
          readErrors: [{
            code: "LISTING_CONTENT_NOT_RETURNED",
            message: "attributes missing",
          }],
        },
      ],
    });

    expect(Array.from(workbook.slice(0, 2))).toEqual([0x50, 0x4b]);
    const archive = unzipSync(workbook);
    const workbookXml = new TextDecoder().decode(archive["xl/workbook.xml"]);
    const auditSheet = new TextDecoder().decode(
      archive["xl/worksheets/sheet1.xml"],
    );
    const notesSheet = new TextDecoder().decode(
      archive["xl/worksheets/sheet2.xml"],
    );
    expect(workbookXml).toContain("圖片健檢");
    expect(auditSheet).toContain("FIVE-IMAGES");
    expect(auditSheet).toContain("UNKNOWN-IMAGES");
    expect(auditSheet).toContain("圖片不足");
    expect(auditSheet).toContain("讀取未完成");
    expect(auditSheet).toContain("LISTING_CONTENT_NOT_RETURNED: attributes missing");
    expect(auditSheet).toContain("https://a/5.jpg");
    expect(notesSheet).toContain("至少 6 張圖片");
    expect(notesSheet).toContain("不含 FBM");
    expect(notesSheet).toContain("不把無法完整讀取的 Listing 冒充為零張圖片");
  });
});

describe("FBA unbound variation audit Excel export", () => {
  it("keeps proven unbound and incomplete relationship evidence in separate sheets", () => {
    const workbook = createUnboundVariationWorkbook({
      marketplaceLabel: "US · Amazon.com",
      fetchedAt: "2026-08-09T02:00:00.000Z",
      rows: [{
        sellerSku: "UNBOUND-01",
        asin: "B000000001",
        title: "Unbound FBA product",
        productType: "PET_FOOD",
        notice: "Amazon relationships 已完整回傳，且沒有 parent 關係。",
      }],
      incompleteRows: [{
        sellerSku: "UNKNOWN-02",
        asin: "B000000002",
        title: "Unknown relationship product",
        code: "RELATIONSHIPS_NOT_RETURNED",
        message: "缺資料不會被誤列為未綁變體。",
      }],
      allVariationRows: [
        {
          familySku: "PARENT-01",
          role: "parent",
          sellerSku: "PARENT-01",
          title: "",
          productType: "",
          variationTheme: null,
          evidence: "parent-sku-from-verified-child",
        },
        {
          familySku: "PARENT-01",
          role: "child",
          sellerSku: "CHILD-01",
          title: "Child product",
          productType: "PET_FOOD",
          variationTheme: "SIZE_NAME",
          evidence: "verified-child",
        },
        {
          familySku: "PARENT-02",
          role: "parent",
          sellerSku: "PARENT-02",
          title: "Second parent",
          productType: "PET_FOOD",
          variationTheme: "FLAVOR_NAME",
          evidence: "verified-parent",
        },
        {
          familySku: "PARENT-02",
          role: "child",
          sellerSku: "CHILD-02",
          title: "Second child",
          productType: "PET_FOOD",
          variationTheme: "FLAVOR_NAME",
          evidence: "verified-child",
        },
        {
          familySku: "PARENT-03",
          role: "parent",
          sellerSku: "PARENT-03",
          title: "Third parent",
          productType: "PET_FOOD",
          variationTheme: "SIZE_NAME",
          evidence: "verified-parent",
        },
        {
          familySku: "PARENT-03",
          role: "child",
          sellerSku: "CHILD-03",
          title: "Third child",
          productType: "PET_FOOD",
          variationTheme: "SIZE_NAME",
          evidence: "verified-child",
        },
      ],
    });

    const archive = unzipSync(workbook);
    const workbookXml = new TextDecoder().decode(archive["xl/workbook.xml"]);
    const unboundSheet = new TextDecoder().decode(
      archive["xl/worksheets/sheet1.xml"],
    );
    const incompleteSheet = new TextDecoder().decode(
      archive["xl/worksheets/sheet2.xml"],
    );
    const allVariationSheet = new TextDecoder().decode(
      archive["xl/worksheets/sheet3.xml"],
    );
    const verticalVariationSheet = new TextDecoder().decode(
      archive["xl/worksheets/sheet4.xml"],
    );
    const styles = new TextDecoder().decode(archive["xl/styles.xml"]);
    expect(workbookXml).toContain("未綁變體");
    expect(workbookXml).toContain("讀取未完成");
    expect(workbookXml).toContain("所有變體");
    expect(workbookXml).toContain("全部變體（直式）");
    expect(unboundSheet).not.toContain("Product Type");
    expect(unboundSheet.indexOf(">SKU<")).toBeLessThan(
      unboundSheet.indexOf(">商品標題<"),
    );
    expect(unboundSheet.indexOf(">商品標題<")).toBeLessThan(
      unboundSheet.indexOf(">ASIN<"),
    );
    expect(unboundSheet).toMatch(
      /<c r="A2" s="2"[^>]*>.*?UNBOUND-01.*?<c r="B2" s="3"[^>]*>.*?Unbound FBA product.*?<c r="C2" s="2"[^>]*>.*?B000000001/su,
    );
    expect(unboundSheet).toContain("UNBOUND-01");
    expect(unboundSheet).not.toContain("UNKNOWN-02");
    expect(incompleteSheet.indexOf(">SKU<")).toBeLessThan(
      incompleteSheet.indexOf(">商品標題<"),
    );
    expect(incompleteSheet.indexOf(">商品標題<")).toBeLessThan(
      incompleteSheet.indexOf(">ASIN<"),
    );
    expect(incompleteSheet).toMatch(
      /<c r="A2" s="2"[^>]*>.*?UNKNOWN-02.*?<c r="B2" s="3"[^>]*>.*?Unknown relationship product.*?<c r="C2" s="2"[^>]*>.*?B000000002/su,
    );
    expect(incompleteSheet).toContain("UNKNOWN-02");
    expect(incompleteSheet).toContain("RELATIONSHIPS_NOT_RETURNED");
    expect(allVariationSheet).not.toContain("ASIN");
    expect(allVariationSheet.indexOf("PARENT-01")).toBeLessThan(
      allVariationSheet.indexOf("CHILD-01"),
    );
    const syntheticParentRow = allVariationSheet.match(
      /<row r="2"[^>]*>.*?<\/row>/su,
    )?.[0];
    expect(syntheticParentRow).toContain("PARENT-01");
    expect(syntheticParentRow).not.toContain("SIZE_NAME");
    expect(syntheticParentRow).toMatch(
      /<c r="F2"[^>]*><is><t[^>]*><\/t><\/is><\/c>/su,
    );
    expect(allVariationSheet).toContain("父變體");
    expect(allVariationSheet).toContain("子變體");

    const styleIndex = (reference: string) => {
      const match = allVariationSheet.match(
        new RegExp(`<c r="${reference}" s="(\\d+)"`, "u"),
      );
      if (!match) throw new Error(`Missing styled cell ${reference}`);
      return Number(match[1]);
    };
    const cellXfs = styles.match(/<cellXfs[^>]*>(.*?)<\/cellXfs>/su)?.[1]
      .match(/<xf\b(?:[^>]*\/>|[^>]*>.*?<\/xf>)/gsu) ?? [];
    const fills = styles.match(/<fills[^>]*>(.*?)<\/fills>/su)?.[1]
      .match(/<fill>.*?<\/fill>/gsu) ?? [];
    const borders = styles.match(/<borders[^>]*>(.*?)<\/borders>/su)?.[1]
      .match(/<border>.*?<\/border>/gsu) ?? [];
    const fillId = (reference: string) => {
      const xf = cellXfs[styleIndex(reference)];
      if (!xf) throw new Error(`Missing cell style for ${reference}`);
      return Number(xf.match(/fillId="(\d+)"/u)?.[1]);
    };
    const border = (reference: string) => {
      const xf = cellXfs[styleIndex(reference)];
      if (!xf) throw new Error(`Missing cell style for ${reference}`);
      const borderId = Number(xf.match(/borderId="(\d+)"/u)?.[1]);
      return borders[borderId] ?? "";
    };
    const fill = (reference: string) => fills[fillId(reference)] ?? "";
    const fontId = (reference: string) => {
      const xf = cellXfs[styleIndex(reference)];
      if (!xf) throw new Error(`Missing cell style for ${reference}`);
      return Number(xf.match(/fontId="(\d+)"/u)?.[1]);
    };

    expect(new Set([fillId("A2"), fillId("A3")])).toEqual(
      new Set([fillId("A2")]),
    );
    expect(new Set([fillId("A4"), fillId("A5")])).toEqual(
      new Set([fillId("A4")]),
    );
    expect(fillId("A2")).not.toBe(fillId("A4"));
    expect(fillId("A2")).toBe(fillId("A6"));
    expect(fill("A2")).toContain('fgColor rgb="FFEAF4FB"');
    expect(fill("A4")).toContain('fgColor rgb="FFF8FBFE"');
    expect(fontId("A2")).toBe(0);
    expect(fontId("A4")).toBe(0);

    expect(border("A2")).toContain('<left style="medium"');
    expect(border("A2")).toContain('<top style="medium"');
    expect(border("G2")).toContain('<right style="medium"');
    expect(border("G2")).toContain('<top style="medium"');
    expect(border("A3")).toContain('<left style="medium"');
    expect(border("A3")).toContain('<bottom style="medium"');
    expect(border("G3")).toContain('<right style="medium"');
    expect(border("G3")).toContain('<bottom style="medium"');

    expect(verticalVariationSheet).toContain("分類");
    expect(verticalVariationSheet).toContain("層級");
    expect(verticalVariationSheet).toContain("未綁／Standalone");
    expect(verticalVariationSheet).toContain("未知／不綁定");
    const verticalRows = verticalVariationSheet.match(
      /<row r="\d+"[^>]*>.*?<\/row>/gsu,
    ) ?? [];
    expect(verticalRows).toHaveLength(9);
    expect(verticalRows[1]).toContain("PARENT-01");
    expect(verticalRows[1]).toContain("父變體");
    expect(verticalRows[2]).toContain("CHILD-01");
    expect(verticalRows[2]).toContain("子變體");
    expect(verticalRows[3]).toContain("PARENT-02");
    expect(verticalRows[5]).toContain("PARENT-03");
    expect(verticalRows[7]).toContain("UNBOUND-01");
    expect(verticalRows[7]).toContain("已確認未綁");
    expect(verticalRows[7]).toContain("無 Parent");
    expect(verticalRows[7]).not.toContain("PARENT-0");
    expect(verticalRows[8]).toContain("UNKNOWN-02");
    expect(verticalRows[8]).toContain("關係讀取未完成");
    expect(verticalRows[8]).toContain("未知／不綁定 Parent");
    expect(verticalRows[8]).not.toContain("PARENT-0");
  });
});
