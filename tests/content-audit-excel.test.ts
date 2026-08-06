import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { createContentAuditWorkbook } from "../src/renderer/src/content-audit-excel";
import type { ContentAuditSnapshot } from "../src/renderer/src/content-quality";

describe("content audit Excel", () => {
  it("exports only rows requiring attention with a readable issue sheet", () => {
    const snapshot: ContentAuditSnapshot = {
      marketplaceId: "ATVPDKIKX0DER",
      fetchedAt: "2026-08-06T08:00:00.000Z",
      rows: [
        {
          sellerSku: "NEEDS-EDIT",
          asin: "B000000001",
          productType: "PET_FOOD",
          title: "GooToE Turkey Tendons",
          bulletPoints: ["Only one point"],
          ingredients: "Turkey",
          readStatus: "complete",
          readErrors: [],
          issues: [
            {
              kind: "MISSING_BULLETS",
              field: "bulletPoints",
              message: "目前只有 1 個非空白賣點，少於 5 個。",
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
    const productSheet = strFromU8(archive["xl/worksheets/sheet1.xml"]);
    const issueSheet = strFromU8(archive["xl/worksheets/sheet2.xml"]);

    expect(productSheet).toContain("NEEDS-EDIT");
    expect(productSheet).not.toContain("CLEAN-SKU");
    expect(issueSheet).toContain("賣點不足");
    expect(issueSheet).toContain("目前只有 1 個非空白賣點");
  });
});
