import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  auditExportFilename,
  type AuditExportKind,
} from "../src/renderer/src/audit-export-filename";

describe("renderer-owned FBA audit export filenames", () => {
  const cases: ReadonlyArray<readonly [AuditExportKind, string]> = [
    ["content", "FBA-文案健檢-US-2026-08-10.xlsx"],
    ["image", "FBA-圖片健檢-US-2026-08-10.xlsx"],
    ["variation", "FBA-未綁變體健檢-US-2026-08-10.xlsx"],
    ["inventory", "FBA-庫齡與預估冗餘健檢-US-2026-08-10.xlsx"],
    ["subscription", "FBA-訂閱價格健檢-US-2026-08-10.xlsx"],
    ["businessPricing", "FBA-B2B價格健檢-US-2026-08-10.xlsx"],
    ["review", "FBA-評論主題健檢-US-2026-08-10.xlsx"],
    ["advertising", "FBA-廣告覆蓋健檢-US-2026-08-10.xlsx"],
    ["suite", "FBA-一鍵全部健檢-US-2026-08-10.xlsx"],
    ["inbound", "FBA-入庫貨件-US-2026-08-10.xlsx"],
  ];

  it.each(cases)("uses the fixed Chinese label for %s", (kind, expected) => {
    expect(auditExportFilename({
      kind,
      marketplaceShort: "us",
      fetchedAt: "2026-08-10T23:59:59.999Z",
    })).toBe(expected);
  });

  it("uses the trusted snapshot date instead of the browser clock", () => {
    expect(auditExportFilename({
      kind: "content",
      marketplaceShort: "JP",
      fetchedAt: "2026-08-06T08:00:00.000Z",
    })).toBe("FBA-文案健檢-JP-2026-08-06.xlsx");
  });

  it("rejects an invalid marketplace label or non-RFC3339 snapshot time", () => {
    expect(() => auditExportFilename({
      kind: "image",
      marketplaceShort: "US/../../unsafe",
      fetchedAt: "2026-08-10T00:00:00.000Z",
    })).toThrow(/站點簡碼無效/u);
    expect(() => auditExportFilename({
      kind: "image",
      marketplaceShort: "US",
      fetchedAt: "2026-08-10",
    })).toThrow(/快照時間無效/u);
    expect(() => auditExportFilename({
      kind: "image",
      marketplaceShort: "US",
      fetchedAt: "2026-02-30T00:00:00.000Z",
    })).toThrow(/快照日期無效/u);
  });

  it.each([
    ["content-audit-excel.ts", "content"],
    ["components/image-audit-panel.tsx", "image"],
    ["components/unbound-variation-audit-panel.tsx", "variation"],
    ["components/aged-inventory-panel.tsx", "inventory"],
    ["components/subscription-audit-panel.tsx", "subscription"],
    ["components/business-pricing-audit-panel.tsx", "businessPricing"],
    ["components/review-audit-panel.tsx", "review"],
    ["inbound-shipments-excel.ts", "inbound"],
  ] as const)("owns the %s download name in the renderer", (file, kind) => {
    const source = readFileSync(
      new URL(`../src/renderer/src/${file}`, import.meta.url),
      "utf8",
    );
    expect(source).toContain("auditExportFilename({");
    expect(source).toContain(`kind: "${kind}"`);
    expect(source).not.toMatch(/anchor\.download\s*=\s*(?:safeFilename|filenameFrom|downloadName)/u);
    expect(source).not.toMatch(/(?:anchor|link)\.download\s*=\s*`amazon-/u);
  });

  it("keeps the legacy suite filename helper without rendering a second combined-result download", () => {
    const source = readFileSync(
      new URL(
        "../src/renderer/src/components/audit-suite-home-card.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source).not.toContain("auditExportFilename({");
    expect(source).not.toContain('kind: "suite"');
    expect(source).not.toContain("下載合併健檢 Excel");
  });
});
