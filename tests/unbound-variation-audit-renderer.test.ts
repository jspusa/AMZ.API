import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import UnboundVariationAuditPanel from "../src/renderer/src/components/unbound-variation-audit-panel";
import { parseUnboundVariationAuditSnapshot } from "../src/renderer/src/unbound-variation-audit";

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
    allVariationRows: [
      {
        familySku: "PARENT-01",
        role: "parent",
        sellerSku: "PARENT-01",
        title: "",
        productType: "",
        variationTheme: "SIZE_NAME",
        evidence: "parent-sku-from-verified-child",
      },
      {
        familySku: "PARENT-01",
        role: "child",
        sellerSku: "CHILD-01",
        title: "Child one",
        productType: "PET_FOOD",
        variationTheme: "SIZE_NAME",
        evidence: "verified-child",
      },
      {
        familySku: "PARENT-01",
        role: "child",
        sellerSku: "CHILD-02",
        title: "Child two",
        productType: "PET_FOOD",
        variationTheme: "SIZE_NAME",
        evidence: "verified-child",
      },
    ],
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
    expect(parsed.allVariationRows.map((row) => row.sellerSku)).toEqual([
      "PARENT-01",
      "CHILD-01",
      "CHILD-02",
    ]);
    expect(parsed.summary.unbound).toBe(1);
  });

  it("accepts a v0.1.25 snapshot without the later allVariationRows field", () => {
    const legacy = { ...snapshot() } as Record<string, unknown>;
    delete legacy.allVariationRows;

    expect(parseUnboundVariationAuditSnapshot(legacy, MARKETPLACE_ID)
      .allVariationRows).toEqual([]);
    expect(() => parseUnboundVariationAuditSnapshot({
      ...legacy,
      allVariationRows: "altered",
    }, MARKETPLACE_ID)).toThrow(/明細格式/u);
  });

  it("rejects an all-variation family unless its parent SKU precedes its children", () => {
    const rows = snapshot().allVariationRows;
    expect(() => parseUnboundVariationAuditSnapshot({
      ...snapshot(),
      allVariationRows: [rows[1], rows[0], rows[2]],
    }, MARKETPLACE_ID)).toThrow(/父變體.*子變體/u);
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

  it("keeps relationship rules in one collapsed public disclosure", () => {
    const markup = renderToStaticMarkup(createElement(UnboundVariationAuditPanel, {
      marketplaceId: MARKETPLACE_ID,
      marketplaceShort: "US",
      onOpenSku: () => undefined,
    }));

    expect(markup).toContain("詳細說明");
    expect(markup).toContain("relationship 判定、未完成隔離與唯讀範圍");
    expect(markup).toContain("Amazon 唯讀＋Fail closed");
    expect(markup).not.toContain('audit-details-disclosure" open=""');
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
    expect(source).toContain("startStandaloneAuditJob");
    expect(source).toContain('download: "1"');
    expect(source).toContain('kind: "variation"');
    expect(source).toContain("fetchedAt: snapshot.fetchedAt");
    expect(source).toContain("匯出未綁變體＋讀取未完成＋所有變體 Excel");
    expect(source).toContain("4 張工作表");
    expect(source).toContain("父變體橫排");
    expect(source).not.toMatch(/method:\s*["'](?:PATCH|PUT|DELETE)["']/);
    expect(source).not.toContain("localStorage");
  });
});
