import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { createContentAuditWorkbook } from "../src/renderer/src/content-audit-excel";
import type { ContentAuditSnapshot } from "../src/renderer/src/content-quality";

describe("content audit Excel", () => {
  it("exports attention rows in one concise sheet with type and description columns", () => {
    const snapshot: ContentAuditSnapshot = {
      marketplaceId: "ATVPDKIKX0DER",
      fetchedAt: "2026-08-06T08:00:00.000Z",
      rows: [
        {
          sellerSku: "NEEDS-EDIT",
          asin: "B000000001",
          productType: "PET_FOOD",
          title: "GooToE Turkey Tendons",
          bulletPoints: ["Natural & Gentle\u200b : Only one point"],
          ingredients: "Turkey",
          readStatus: "complete",
          readErrors: [],
          issues: [
            {
              kind: "MISSING_BULLETS",
              field: "bulletPoints",
              message: "目前只有 1 個非空白賣點，少於 5 個。",
            },
            {
              kind: "SUSPECTED_TYPO",
              field: "bulletPoints",
              token: "U+200B",
              suggestion: "移除不可見字元",
              message: "發現不可見字元 U+200B。",
            },
          ],
        },
        {
          sellerSku: "CLEAN-SKU",
          asin: "B000000002",
          productType: "PET_FOOD",
          title: "Complete listing",
          bulletPoints: ["1", "2", "3", "4", "5"],
          ingredients: "Turkey",
          readStatus: "complete",
          readErrors: [],
          issues: [],
        },
      ],
      readErrors: [],
      summary: {
        total: 2,
        completed: 2,
        incomplete: 0,
        withIssues: 1,
        suspectedTypos: 0,
        missingBullets: 1,
        missingIngredients: 0,
        ingredientsUnverified: 0,
      },
    };

    const archive = unzipSync(createContentAuditWorkbook(snapshot, "US"));
    const workbook = strFromU8(archive["xl/workbook.xml"]);
    const productSheet = strFromU8(archive["xl/worksheets/sheet1.xml"]);
    const styles = strFromU8(archive["xl/styles.xml"]);

    expect(workbook).toContain('sheet name="內容健檢"');
    expect(archive["xl/worksheets/sheet2.xml"]).toBeUndefined();
    expect(productSheet).toContain("NEEDS-EDIT");
    expect(productSheet).not.toContain("CLEAN-SKU");
    expect(productSheet).toContain("類型");
    expect(productSheet).toContain("說明");
    expect(productSheet).not.toContain(">狀態<");
    expect(productSheet).not.toContain(">最後更新<");
    expect(productSheet).toContain("賣點不足");
    expect(productSheet).toContain("目前只有 1 個非空白賣點");
    expect(productSheet).toContain("U+200B（零寬空格）位於");
    expect(productSheet).toContain("Gentle");
    expect(productSheet).toContain("應手動修改此段");
    expect(productSheet).toContain('<color rgb="FFC62828"/>');
    expect(styles).toContain('<fgColor rgb="FFFFF2CC"/>');
    expect(styles).toContain('fillId="3"');
    expect(productSheet).toMatch(/<c r="F2" s="5" t="inlineStr">/u);
    expect(productSheet).toMatch(/<c r="E2" s="3" t="inlineStr">/u);
    expect(productSheet).toMatch(/<c r="K2" s="3" t="inlineStr">/u);
    expect(productSheet).toContain("⟦U+200B 零寬空格⟧");
    expect(productSheet).toMatch(
      /<r><rPr><b\/><color rgb="FFC62828"\/>.*?<t xml:space="preserve">⟦U\+200B 零寬空格⟧<\/t><\/r>/u,
    );
  });
});
