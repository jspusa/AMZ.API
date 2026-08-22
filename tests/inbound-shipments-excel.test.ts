import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  assertInboundShipmentWorkbookBudget,
  createInboundShipmentWorkbook,
  inboundShipmentWorkbookBudget,
  INBOUND_WORKBOOK_MAX_CELLS,
  INBOUND_WORKBOOK_MAX_ESTIMATED_XML_BYTES,
} from "../src/renderer/src/inbound-shipments-excel";
import { parseInboundShipmentSnapshot } from "../src/renderer/src/inbound-shipments";
import {
  inboundShipmentSnapshotFixture,
  US_MARKETPLACE_ID,
} from "./inbound-shipments-fixture";

describe("FBA inbound shipment Excel", () => {
  it("exports shipment, item, differences, three issue levels, and source boundaries", () => {
    const snapshot = parseInboundShipmentSnapshot(
      inboundShipmentSnapshotFixture(),
      US_MARKETPLACE_ID,
    );
    const bytes = createInboundShipmentWorkbook(snapshot, "US");
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x50, 0x4b]);

    const archive = unzipSync(bytes);
    const workbook = strFromU8(archive["xl/workbook.xml"]);
    for (const name of [
      "貨件摘要",
      "商品接收明細",
      "僅顯示差異",
      "貨件層級瑕疵",
      "包裝箱層級瑕疵",
      "產品層級瑕疵",
      "資料來源與限制",
    ]) {
      expect(workbook).toContain(`name="${name}"`);
    }

    const shipment = strFromU8(archive["xl/worksheets/sheet1.xml"]);
    const items = strFromU8(archive["xl/worksheets/sheet2.xml"]);
    const differences = strFromU8(archive["xl/worksheets/sheet3.xml"]);
    const shipmentIssues = strFromU8(archive["xl/worksheets/sheet4.xml"]);
    const cartonIssues = strFromU8(archive["xl/worksheets/sheet5.xml"]);
    const productIssues = strFromU8(archive["xl/worksheets/sheet6.xml"]);
    const limitations = strFromU8(archive["xl/worksheets/sheet7.xml"]);

    expect(shipment).toContain("Amazon 已接收（SP-API QuantityReceived）");
    expect(shipment).toContain("尚在接收 20 單位／暫時差異");
    expect(shipment).toContain("Seller Central 核對");
    expect(items).toContain("TEST-SKU-001");
    expect(items).toContain("=FORMULA-SAFE");
    expect(items).toContain("+Formula-like title");
    expect(items).not.toContain("<f>");
    expect(differences).toContain("TEST-SKU-002");
    expect(differences).toContain("=FORMULA-SAFE");
    expect(shipmentIssues).toContain("Amazon 每日問題報表未回傳此層級瑕疵");
    expect(cartonIssues).toContain("Amazon 每日問題報表未回傳此層級瑕疵");
    expect(productIssues).toContain("Barcode cannot be scanned");
    expect(productIssues).toContain("Example Dog Treats");
    expect(limitations).toContain("不冒充 Seller Central 即時");
    expect(limitations).toContain("不稱短少或遺失");
    expect(limitations).toContain("已排除 2 個不在本次貨件快照內");
    expect(limitations).toContain("未輸出其識別碼");
    expect(limitations).toContain("貨件數量快照時間");
    expect(limitations).toContain("貨件清單範圍");
    expect(limitations).toContain("所選日期範圍");
    expect(limitations).toContain("每日瑕疵報表讀取時間");
    expect(limitations).toContain("Amazon 未提供可證明的 dataThrough");
    expect(limitations).toContain("2026-08-21T08:00:00.000Z");
    expect(limitations).toContain("2026-08-21T07:55:00.000Z");
    expect(JSON.stringify(Object.keys(archive))).not.toContain("accountScope");
  });

  it("allows the exact cell budget and rejects a larger workbook before XML generation", () => {
    const snapshot = parseInboundShipmentSnapshot(
      inboundShipmentSnapshotFixture(),
      US_MARKETPLACE_ID,
    );
    const shipmentTemplate = snapshot.shipments[0];
    snapshot.shipments = Array.from({ length: 3 }, (_, index) => ({
      ...shipmentTemplate,
      shipmentId: `FBA19BUDGET${index}`,
      itemCoverage: "complete" as const,
    }));
    const itemTemplate = snapshot.items[0];
    snapshot.items = Array.from({ length: 38_448 }, (_, index) => ({
      ...itemTemplate,
      shipmentId: snapshot.shipments[0].shipmentId,
      sellerSku: `BUDGET-${index}`,
      expectedUnits: 0,
      receivedUnits: 0,
      pendingUnits: 0,
      overReceivedUnits: 0,
    }));
    snapshot.issueReport.shipment = [];
    snapshot.issueReport.carton = [];
    snapshot.issueReport.product = [];

    expect(inboundShipmentWorkbookBudget(snapshot).totalCells)
      .toBe(INBOUND_WORKBOOK_MAX_CELLS);
    snapshot.items.push({ ...snapshot.items[0], sellerSku: "OVER-BUDGET" });
    expect(() => createInboundShipmentWorkbook(snapshot, "US"))
      .toThrow(/請縮小日期範圍.*未產生截斷檔案/u);
  });

  it("rejects escaped long-text XML below the cell cap before allocating worksheet strings", () => {
    const snapshot = parseInboundShipmentSnapshot(
      inboundShipmentSnapshotFixture(),
      US_MARKETPLACE_ID,
    );
    const shipment = { ...snapshot.shipments[0], itemCoverage: "complete" as const };
    snapshot.shipments = [shipment];
    const itemTemplate = snapshot.items[0];
    const escapedLongTitle = "&".repeat(5_000);
    snapshot.items = Array.from({ length: 19_000 }, (_, index) => ({
      ...itemTemplate,
      shipmentId: shipment.shipmentId,
      sellerSku: `LONG-${index}`,
      title: escapedLongTitle,
      expectedUnits: 1,
      receivedUnits: 0,
      pendingUnits: 1,
      overReceivedUnits: 0,
    }));
    snapshot.issueReport.shipment = [];
    snapshot.issueReport.carton = [];
    snapshot.issueReport.product = [];

    const budget = inboundShipmentWorkbookBudget(snapshot);
    expect(budget.totalCells).toBeLessThan(INBOUND_WORKBOOK_MAX_CELLS);
    expect(budget.estimatedXmlBytes).toBeGreaterThan(
      INBOUND_WORKBOOK_MAX_ESTIMATED_XML_BYTES,
    );
    expect(() => assertInboundShipmentWorkbookBudget(snapshot))
      .toThrow(/預估未壓縮 XML 32 MiB.*請縮小日期範圍.*未產生截斷檔案/u);
  });

  it("keeps partial shipments in the differences sheet when the unknown rows are zero or absent", () => {
    const snapshot = parseInboundShipmentSnapshot(
      inboundShipmentSnapshotFixture(),
      US_MARKETPLACE_ID,
    );
    const partialShipment = snapshot.shipments[0];
    partialShipment.itemCoverage = "partial";
    partialShipment.totals = null;
    snapshot.items = snapshot.items.filter(
      (item) => item.shipmentId !== partialShipment.shipmentId,
    );
    const archive = unzipSync(createInboundShipmentWorkbook(snapshot, "US"));
    const differences = strFromU8(archive["xl/worksheets/sheet3.xml"]);
    const summary = strFromU8(archive["xl/worksheets/sheet1.xml"]);
    expect(differences).toContain(partialShipment.shipmentId);
    expect(differences).toContain("明細未完整");
    expect(differences).toContain("差異未知");
    expect(summary).toContain("已讀取 SKU 列數");
  });
});
