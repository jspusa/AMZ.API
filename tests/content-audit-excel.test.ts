import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { parseContentAuditWorkbook } from "../src/main/amazon/content-audit-workbook-parser";
import { createContentAuditWorkbook } from "../src/renderer/src/content-audit-excel";
import type {
  ContentAuditRow,
  ContentAuditSnapshot,
} from "../src/renderer/src/content-quality";

type WorkbookAuditRow = ContentAuditRow & {
  variationRole: "parent" | "child" | "standalone" | "unknown";
  variationParentSku: string | null;
  variationFamilyKey: string | null;
  variationTheme: string | null;
};

type WorkbookAuditSnapshot = Omit<ContentAuditSnapshot, "rows"> & {
  exportId: string;
  rows: WorkbookAuditRow[];
};

function summary(): ContentAuditSnapshot["summary"] {
  return {
    total: 5,
    completed: 4,
    incomplete: 1,
    withIssues: 4,
    suspectedTypos: 1,
    missingBullets: 1,
    missingIngredients: 0,
    ingredientsUnverified: 0,
    singleIngredientMismatch: 1,
    titleBelowTarget: 0,
    highlightBelowTarget: 1,
    bulletBelowTarget: 0,
    bulletAboveTarget: 0,
    descriptionBelowTarget: 0,
  };
}

describe("content audit Excel", () => {
  it("exports schema v2 by proven variation family and colors the exact issue field", () => {
    const base = {
      productType: "PET_FOOD",
      itemHighlight: "A concise highlight",
      productDescription: "A complete product description",
      ingredients: "Turkey",
      readStatus: "complete" as const,
      readErrors: [],
      variationTheme: "SIZE_NAME",
    };
    const snapshot: WorkbookAuditSnapshot = {
      marketplaceId: "ATVPDKIKX0DER",
      exportId: "export-content-audit-v2",
      fetchedAt: "2026-08-06T08:00:00.000Z",
      rows: [
        {
          ...base,
          sellerSku: "FAMILY-B-CHILD",
          asin: "B000000004",
          title: "Single-Ingredient Family B child",
          ingredients: "Turkey, Chicken",
          bulletPoints: ["One", "Two", "Three", "Four", "Five"],
          variationRole: "child",
          variationParentSku: "PARENT-B",
          variationFamilyKey: "PARENT-B",
          issues: [
            {
              kind: "HIGHLIGHT_BELOW_TARGET",
              field: "itemHighlight",
              message: "產品亮點目前 19 字元，低於 110 字元。",
            },
            {
              kind: "SINGLE_INGREDIENT_MISMATCH",
              field: "title",
              token: "Single-Ingredient",
              message: "產品名稱宣稱「Single-Ingredient」，但 Amazon ingredients 已明確列出 2 項：Turkey、Chicken。",
            },
          ],
        },
        {
          ...base,
          sellerSku: "NEEDS-EDIT",
          asin: "B000000001",
          title: "GooToE Turkey Tendons",
          bulletPoints: ["Natural & Gentle\u200b : Only one point"],
          variationRole: "child",
          variationParentSku: "PARENT-A",
          variationFamilyKey: "PARENT-A",
          issues: [
            {
              kind: "MISSING_BULLETS",
              field: "bulletPoints",
              message: "目前只有 1 個非空白賣點，少於 5 個。",
            },
            {
              kind: "SUSPECTED_TYPO",
              field: "bulletPoints",
              bulletIndex: 0,
              token: "U+200B",
              suggestion: "移除不可見字元",
              message: "發現不可見字元 U+200B。",
            },
          ],
        },
        {
          ...base,
          sellerSku: "STANDALONE-ISSUE",
          asin: "B000000002",
          title: "Standalone listing",
          bulletPoints: ["One", "Two", "Three", "Four", "Five"],
          variationRole: "standalone",
          variationParentSku: null,
          variationFamilyKey: "SELF-SHOULD-NOT-BECOME-A-SHEET",
          variationTheme: null,
          issues: [{
            kind: "HIGHLIGHT_BELOW_TARGET",
            field: "itemHighlight",
            message: "產品亮點目前 19 字元，低於 110 字元。",
          }],
        },
        {
          ...base,
          sellerSku: "UNKNOWN-RELATIONSHIP",
          asin: "B000000003",
          title: "Relationship unavailable",
          bulletPoints: [],
          readStatus: "incomplete",
          readErrors: [{
            code: "LISTING_CONTENT_NOT_RETURNED",
            message: "relationships missing",
          }],
          variationRole: "unknown",
          variationParentSku: null,
          variationFamilyKey: "UNKNOWN-RELATIONSHIP",
          variationTheme: null,
          issues: [],
        },
        {
          ...base,
          sellerSku: "CLEAN-SKU",
          asin: "B000000005",
          title: "Complete listing",
          bulletPoints: ["1", "2", "3", "4", "5"],
          variationRole: "child",
          variationParentSku: "PARENT-A",
          variationFamilyKey: "PARENT-A",
          issues: [],
        },
      ],
      readErrors: [],
      summary: summary(),
    };

    const bytes = createContentAuditWorkbook(
      snapshot as ContentAuditSnapshot,
      "US",
    );
    const archive = unzipSync(bytes);
    const workbook = strFromU8(archive["xl/workbook.xml"]!);
    const indexSheet = strFromU8(archive["xl/worksheets/sheet1.xml"]!);
    const familyA = strFromU8(archive["xl/worksheets/sheet2.xml"]!);
    const familyB = strFromU8(archive["xl/worksheets/sheet3.xml"]!);
    const standalone = strFromU8(archive["xl/worksheets/sheet4.xml"]!);
    const incomplete = strFromU8(archive["xl/worksheets/sheet5.xml"]!);
    const styles = strFromU8(archive["xl/styles.xml"]!);

    expect(workbook).toContain('sheet name="說明與索引"');
    expect(workbook).toContain('sheet name="F001"');
    expect(workbook).toContain('sheet name="F002"');
    expect(workbook).toContain('sheet name="未綁變體"');
    expect(workbook).toContain('sheet name="資料未完成"');
    expect(indexSheet).toContain("Schema Version");
    expect(indexSheet).toContain("export-content-audit-v2");
    expect(indexSheet).toContain("只能編輯淺藍色");
    expect(indexSheet).toContain("PARENT-A");
    expect(indexSheet).toContain("PARENT-B");
    expect(indexSheet).toContain("STANDALONE");
    expect(indexSheet).toContain("DATA_INCOMPLETE");

    expect(familyA).toContain("NEEDS-EDIT");
    expect(familyA).not.toContain("CLEAN-SKU");
    expect(familyB).toContain("FAMILY-B-CHILD");
    expect(familyB).toContain("單一成分宣稱不一致");
    expect(familyB).toContain("Amazon ingredients");
    expect(familyB).toMatch(/<c r="H2" s="6" t="inlineStr">/u);
    expect(standalone).toContain("STANDALONE-ISSUE");
    expect(incomplete).toContain("UNKNOWN-RELATIONSHIP");
    expect(familyA).toContain("原始產品名稱");
    expect(familyA).toContain("更新產品名稱");
    expect(familyA).toContain("原始產品亮點");
    expect(familyA).toContain("更新產品敘述");
    expect(familyA).toContain("類型");
    expect(familyA).toContain("說明");

    expect(styles).toContain('<fgColor rgb="FFFFF2CC"/>');
    expect(styles).toContain('<fgColor rgb="FFE7E6E6"/>');
    expect(styles).toContain('<fgColor rgb="FFDDEBF7"/>');
    expect(familyA).toMatch(/<c r="H2" s="6" t="inlineStr">/u);
    expect(familyA).toMatch(/<c r="I2" s="5" t="inlineStr">/u);
    expect(familyA).toContain("⟦U+200B 零寬空格⟧");

    const parsed = parseContentAuditWorkbook({
      bytes,
      fileName: "content-audit.xlsx",
      mediaType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const parsedInvisibleRow = parsed.rows.find(
      (row) => row.sellerSku === "NEEDS-EDIT",
    );
    expect(parsedInvisibleRow?.original.bulletPoints[0]).toBe(
      "Natural & Gentle\u200b : Only one point",
    );
    expect(parsedInvisibleRow?.proposed.bulletPoints[0]).toBe(
      "Natural & Gentle\u200b : Only one point",
    );
  });
});
