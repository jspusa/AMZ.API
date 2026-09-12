import { describe, expect, it } from "vitest";
import { parseVineImport } from "../src/shared/vine";

import { vinePage, vinePageRow } from "./fixtures/vine-page";

describe("Seller Central Vine whole-page import", () => {
  it("separates both dates and four count columns, including multiline pending/pre-release states", () => {
    const text = vinePage(
      vinePageRow(),
      vinePageRow({ asin: "B000000002", date: "9/2/2026", status: "\ue00e\n 等待處理\n正在等待庫存 (30)", available: "0", claimed: "0", reviews: "0" }),
      vinePageRow({ asin: "B000000003", date: "9/2/2026", status: "預發佈\n正在等待評論", claimed: "30", reviews: "1" }),
      vinePageRow({ asin: "B000000004", date: "4/12/2026", status: "已結束", reviews: "17" }),
    );
    const result = parseVineImport(text, "2026-09-11");
    expect(result.rejected).toEqual([]);
    expect(result.rows.map(({ value }) => ({ asin: value.asin, enrollmentDate: value.enrollmentDate, status: value.status, enrolled: value.enrolled, reviews: value.reviews }))).toEqual([
      { asin: "B000000001", enrollmentDate: "2026-06-16", status: "active", enrolled: 30, reviews: 22 },
      { asin: "B000000002", enrollmentDate: "2026-09-02", status: "active", enrolled: 30, reviews: 0 },
      { asin: "B000000003", enrollmentDate: "2026-09-02", status: "active", enrolled: 30, reviews: 1 },
      { asin: "B000000004", enrollmentDate: "2026-04-12", status: "ended", enrolled: 30, reviews: 17 },
    ]);
    expect(result.rows[0].value).toMatchObject({ title: "Sample product, small | 2 pack", sellerSku: null, claimed: 29 });
  });
});

describe("Vine source completeness and validation", () => {
  it("counts a 25-row synthetic page as 11 active and 14 ended while keeping a June enrollment", () => {
    const rows = Array.from({ length: 25 }, (_, index) => vinePageRow({
      asin: `B${String(index + 1).padStart(9, "0")}`,
      status: index >= 11 ? "已結束" : index === 0 ? "\ue00e\n等待處理\n正在等待庫存 (30)" : index === 1 ? "預發佈\n正在等待評論" : "正在等待評論",
      date: index >= 11 ? "4/12/2026" : index === 10 ? "6/16/2026" : "9/2/2026",
      reviews: index === 10 ? "22" : "1",
    }));
    const parsed = parseVineImport(vinePage(...rows), "2026-09-11");
    expect(parsed.rejected).toEqual([]);
    expect(parsed.rows.filter(({ value }) => value.status === "active")).toHaveLength(11);
    expect(parsed.rows.filter(({ value }) => value.status === "ended")).toHaveLength(14);
    expect(parsed.rows[10].value).toMatchObject({ enrollmentDate: "2026-06-16", enrolled: 30, reviews: 22 });
  });

  it.each(["狀態更新中", "預發佈", "已結束\n正在等待評論"])("rejects an unconfirmed or contradictory status without guessing: %s", (status) => {
    const parsed = parseVineImport(vinePage(vinePageRow({ status }), vinePageRow({ asin: "B000000002", reviews: "30" })), "2026-09-11");
    expect(parsed.rejected).toHaveLength(1);
    expect(parsed.rejected[0].message).toContain("狀態");
    expect(parsed.rows).toHaveLength(1);
    // All reviews received does not itself prove that Amazon ended enrollment.
    expect(parsed.rows[0].value).toMatchObject({ asin: "B000000002", status: "active", reviews: 30 });
  });

  it.each([
    vinePageRow().replace("2,316\n", ""),
    vinePageRow().replace("29\n22\n", "29\n"),
    vinePageRow().replace("22\n\n詳情", "22\n9\n\n詳情"),
    vinePageRow().replace("12/31/2026", "12/32/2026"),
    vinePageRow({ reviews: "31" }),
    vinePageRow({ title: "Sample\u202eproduct" }),
    vinePageRow({ date: "9/12/2026" }),
  ])("keeps a malformed/truncated product row out without shifting count columns", (row) => {
    const parsed = parseVineImport(vinePage(row), "2026-09-11");
    expect(parsed.rows).toEqual([]);
    expect(parsed.rejected).toHaveLength(1);
  });

  it("rejects duplicate ASIN/date rows regardless of their title or progress", () => {
    const parsed = parseVineImport(vinePage(vinePageRow(), vinePageRow({ title: "Updated title", reviews: "23" })), "2026-09-11");
    expect(parsed.rows).toEqual([]);
    expect(parsed.rejected).toHaveLength(2);
    expect(parsed.rejected.every(({ message }) => message.includes("同一 ASIN"))).toBe(true);
  });

  it("requires intact column labels and refuses oversized or over-capacity pasted pages", () => {
    expect(() => parseVineImport(vinePageRow(), "2026-09-11")).toThrow("欄位標題");
    expect(() => parseVineImport(vinePage(vinePageRow()).replace("可用\n已註冊", "已註冊\n可用"), "2026-09-11")).toThrow("欄位標題");
    expect(() => parseVineImport("x".repeat(512 * 1024 + 1), "2026-09-11")).toThrow("512 KB");
    expect(() => parseVineImport(vinePage(...Array.from({ length: 1_001 }, () => vinePageRow())), "2026-09-11")).toThrow("1,000");
  });

  it.each(["取消", "停止"])("does not interpret the action button %s after details as terminal status", (action) => {
    const row = vinePageRow().replace("詳情\n\n停止", `詳情\n\n${action}`);
    const result = parseVineImport(vinePage(row), "2026-09-11");
    expect(result.rejected).toEqual([]);
    expect(result.rows[0].value.status).toBe("active");
  });

  it("requires explicit status in the secondary CSV path and does not require a SKU", () => {
    const legacy = "enrollmentDate,sellerSku,asin,enrolled,claimed,reviews\n2026-06-16,SAMPLE,B000000001,30,29,22";
    expect(parseVineImport(legacy, "2026-09-11")).toMatchObject({ rows: [], rejected: [{ line: 2, message: expect.stringContaining("缺少明確狀態") }] });
    const parsed = parseVineImport("enrollmentDate,sellerSku,asin,enrolled,claimed,reviews,status\n2026-06-16,,B000000001,30,29,22,active", "2026-09-11");
    expect(parsed.rejected).toEqual([]);
    expect(parsed.rows[0].value).toMatchObject({ sellerSku: null, status: "active", reviews: 22 });
  });
});
