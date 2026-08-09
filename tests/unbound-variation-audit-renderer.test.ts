import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseUnboundVariationAuditSnapshot } from "../src/renderer/src/unbound-variation-audit";
import { downloadName } from "../src/renderer/src/components/unbound-variation-audit-panel";

const MARKETPLACE_ID = "ATVPDKIKX0DER";

function snapshot() {
  return {
    mode: "live",
    marketplaceId: MARKETPLACE_ID,
    fetchedAt: "2026-08-09T02:00:00.000Z",
    exportId: "audit-export-0001",
    rows: [{
      sellerSku: "UNBOUND-01",
      asin: "B000000001",
      title: "Unbound FBA product",
      productType: "PET_FOOD",
      relationshipEvidence: "relationships",
      notice: "Amazon relationships 已完整回傳，且沒有 parent 關係。",
    }],
    incompleteRows: [{
      sellerSku: "UNKNOWN-02",
      asin: "B000000002",
      title: "Unknown relationship product",
      code: "RELATIONSHIPS_NOT_RETURNED",
      message: "Amazon 沒有回傳 relationships 資料集。",
      requestId: null,
    }],
    summary: {
      totalFbaListings: 4,
      completed: 3,
      unbound: 1,
      boundChildren: 2,
      parentContainers: 0,
      incomplete: 1,
    },
    notice: "只有完整證據才列入。",
  };
}

describe("unbound variation audit renderer parser", () => {
  it("accepts an internally consistent same-marketplace response", () => {
    const parsed = parseUnboundVariationAuditSnapshot(snapshot(), MARKETPLACE_ID);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.incompleteRows).toHaveLength(1);
    expect(parsed.summary.unbound).toBe(1);
  });

  it("rejects cross-marketplace and summary mismatches before caching", () => {
    expect(() => parseUnboundVariationAuditSnapshot({
      ...snapshot(),
      marketplaceId: "A2EUQ1WTGCTBG2",
    }, MARKETPLACE_ID)).toThrow(/站點不符/);
    expect(() => parseUnboundVariationAuditSnapshot({
      ...snapshot(),
      summary: { ...snapshot().summary, unbound: 2 },
    }, MARKETPLACE_ID)).toThrow(/摘要與明細/);
  });

  it("rejects altered Seller SKU and export identifiers instead of trimming them", () => {
    expect(() => parseUnboundVariationAuditSnapshot({
      ...snapshot(),
      rows: [{ ...snapshot().rows[0], sellerSku: " UNBOUND-01" }],
    }, MARKETPLACE_ID)).toThrow(/Seller SKU格式無法精確辨識/);
    expect(() => parseUnboundVariationAuditSnapshot({
      ...snapshot(),
      incompleteRows: [{
        ...snapshot().incompleteRows[0],
        sellerSku: "UNKNOWN-02 ",
      }],
    }, MARKETPLACE_ID)).toThrow(/未完成 Seller SKU格式無法精確辨識/);
    expect(() => parseUnboundVariationAuditSnapshot({
      ...snapshot(),
      exportId: " audit-export-0001",
    }, MARKETPLACE_ID)).toThrow(/Excel 匯出 ID 格式無法精確辨識/);
  });

  it("uses the dedicated read-only lifecycle and account-scoped Excel export", () => {
    const source = readFileSync(
      new URL(
        "../src/renderer/src/components/unbound-variation-audit-panel.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source).toContain("/api/sp-api/variation-audit");
    expect(source).toContain('method: "POST"');
    expect(source).toContain('download: "1"');
    expect(source).toContain("匯出未綁變體＋讀取未完成 Excel");
    expect(source).not.toMatch(/method:\s*["'](?:PATCH|PUT|DELETE)["']/);
    expect(source).not.toContain("localStorage");
  });

  it("prefers and decodes an RFC 5987 Chinese download filename", () => {
    const response = new Response(null, {
      headers: {
        "content-disposition":
          "attachment; filename=unbound-variation.xlsx; filename*=UTF-8''FBA-%E6%9C%AA%E7%B6%81%E8%AE%8A%E9%AB%94%E5%81%A5%E6%AA%A2-US-2026-08-09.xlsx",
      },
    });
    expect(downloadName(response, "fallback.xlsx")).toBe(
      "FBA-未綁變體健檢-US-2026-08-09.xlsx",
    );
  });

  it("falls back safely when filename-star encoding is malformed", () => {
    const response = new Response(null, {
      headers: {
        "content-disposition":
          "attachment; filename=unbound-variation.xlsx; filename*=UTF-8''%E6%ZZ",
      },
    });
    expect(downloadName(response, "FBA-未綁變體健檢-US.xlsx")).toBe(
      "FBA-未綁變體健檢-US.xlsx",
    );
  });
});
