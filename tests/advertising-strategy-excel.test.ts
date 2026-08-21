import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  advertisingStrategyWorkbookFilename,
  createAdvertisingStrategyWorkbook,
} from "../src/renderer/src/advertising-strategy-excel";
import { parseAdvertisingStrategySnapshot } from "../src/renderer/src/advertising-strategy";
import {
  ADVERTISING_STRATEGY_EXPECTED,
  advertisingStrategySnapshotFixture,
} from "./advertising-strategy-fixture";

describe("FBA advertising strategy Excel", () => {
  it("keeps the familiar columns, adds actual SP evidence, tiers, filters, and source sheets", () => {
    const snapshot = parseAdvertisingStrategySnapshot(
      advertisingStrategySnapshotFixture(),
      ADVERTISING_STRATEGY_EXPECTED,
    );
    const bytes = createAdvertisingStrategyWorkbook(snapshot);
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x50, 0x4b]);
    const archive = unzipSync(bytes);
    const workbook = strFromU8(archive["xl/workbook.xml"]);
    const main = strFromU8(archive["xl/worksheets/sheet1.xml"]);
    const sources = strFromU8(archive["xl/worksheets/sheet2.xml"]);
    const unresolved = strFromU8(archive["xl/worksheets/sheet3.xml"]);
    const styles = strFromU8(archive["xl/styles.xml"]);

    expect(workbook).toContain('name="廣告策略"');
    expect(workbook).toContain('name="資料來源與規則"');
    expect(workbook).toContain('name="未完成明細"');
    expect(main).toContain("SP花費排名");
    expect(main).toContain("SP實際花費 (USD)");
    expect(main).toContain("SP實際14日歸因銷售 (USD)");
    expect(main).toContain("SP實際14日購買次數");
    expect(main).toContain("SP實際ACoS");
    expect(main).toContain("無歸因銷售");
    expect(main).toContain('pane ySplit="1"');
    expect(main).toContain('autoFilter ref="A1:AC5"');
    expect(main).not.toContain("<f>");
    expect(styles).toContain('rgb="FF4EA72E"');
    expect(styles).toContain('rgb="FFFFFF00"');
    expect(styles).toContain('rgb="FFE97132"');
    expect(sources).toContain("目前 FBA 清單讀取時間");
    expect(sources).toContain("SKU 銷售報表讀取時間");
    expect(sources).toContain("SP advertised-product 下載完成時間");
    expect(sources).toContain("未回傳，不補 0");
    expect(sources).toContain("未證明 FBA（僅匿名計數）");
    expect(sources).toContain("未證明 FBA 列的數值不納入");
    expect(sources).toContain("可人工覆寫");
    expect(sources).toContain("不以銷售額 ÷ 單位數推算價格");
    expect(unresolved).toContain("sales-sku-asin-mismatch");
    expect(unresolved).not.toContain("sp-ambiguous-asin");
    expect(unresolved).not.toContain("sales-unknown-sku");
    const exportedXml = `${main}\n${sources}\n${unresolved}`;
    expect(exportedXml).not.toContain("SKU-X");
    expect(exportedXml).not.toContain("B000000009");

    const firstDataRow = /<row r="2"[^>]*>([\s\S]*?)<\/row>/u.exec(main)?.[1] ?? "";
    const tierCells = Array.from(firstDataRow.matchAll(/<c r="([A-Z]+)2"[^>]*><is><t[^>]*>(T[1-4])<\/t><\/is><\/c>/gu));
    expect(tierCells.map((match) => match[1])).toEqual(["G"]);
  });

  it("refuses an oversized workbook instead of freezing or silently truncating it", () => {
    const snapshot = parseAdvertisingStrategySnapshot(
      advertisingStrategySnapshotFixture(),
      ADVERTISING_STRATEGY_EXPECTED,
    );
    const oversized = {
      ...snapshot,
      rows: Array.from({ length: 12_000 }, () => snapshot.rows[0]),
      unresolved: [],
    };

    expect(() => createAdvertisingStrategyWorkbook(oversized))
      .toThrow("資料量超過安全產生範圍");
  });

  it("uses the required Traditional Chinese filename", () => {
    expect(advertisingStrategyWorkbookFilename(advertisingStrategySnapshotFixture()))
      .toBe("FBA-廣告策略-US-2026-08-07.xlsx");
  });
});
