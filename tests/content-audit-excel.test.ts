import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { parseContentAuditWorkbook } from
  "../src/main/amazon/content-audit-workbook-parser";
import {
  createContentAuditWorkbookV2,
  type ContentAuditWorkbookV2Row,
} from "../src/main/amazon/xlsx";
import { contentAuditAttentionRows } from
  "../src/renderer/src/content-audit-excel";
import type {
  ContentAuditRow,
  ContentAuditSnapshot,
} from "../src/renderer/src/content-quality";

function row(
  sellerSku: string,
  readStatus: "complete" | "incomplete",
  issues: ContentAuditRow["issues"] = [],
): ContentAuditRow {
  return {
    sellerSku,
    asin: "B000000001",
    productType: "PET_FOOD",
    title: sellerSku,
    itemHighlight: "",
    bulletPoints: [],
    productDescription: "",
    ingredients: "Turkey",
    readStatus,
    readErrors: readStatus === "incomplete"
      ? [{
          code: "LISTING_CONTENT_NOT_RETURNED",
          message: "Amazon content incomplete.",
        }]
      : [],
    issues,
  };
}

describe("renderer content audit selection", () => {
  it("keeps only issue and fail-visible rows for the main-owned export action", () => {
    const issue = {
      kind: "MISSING_BULLETS" as const,
      field: "bulletPoints" as const,
      message: "Missing bullets.",
    };
    const rows = [
      row("CLEAN", "complete"),
      row("ISSUE", "complete", [issue]),
      row("INCOMPLETE", "incomplete"),
    ];
    const snapshot = {
      marketplaceId: "ATVPDKIKX0DER",
      fetchedAt: "2030-01-02T03:04:05.000Z",
      exportId: "11111111-1111-4111-8111-111111111111",
      rows,
      readErrors: [],
      summary: {} as ContentAuditSnapshot["summary"],
    } satisfies ContentAuditSnapshot;

    expect(contentAuditAttentionRows(snapshot).map((item) => item.sellerSku))
      .toEqual(["ISSUE", "INCOMPLETE"]);
  });
});

describe("main-owned content audit workbook", () => {
  it("preserves schema-v2 family sheets, issue styles, and round-trip source cells", () => {
    const base: ContentAuditWorkbookV2Row = {
      sellerSku: "FAMILY-A-CHILD",
      asin: "B000000001",
      productType: "PET_FOOD",
      title: "Turkey Tendons",
      itemHighlight: "Original highlight",
      bulletPoints: [
        "Natural & Gentle\u200b : Only one point",
        "Two",
        "Three",
        "Four",
        "Five",
      ],
      productDescription: "Original description",
      ingredients: "Turkey",
      variationRole: "child",
      variationParentSku: "PARENT-A",
      variationFamilyKey: "PARENT-A",
      variationTheme: "SIZE_NAME",
      auditType: "不可見字元 · 產品要點",
      auditDescription:
        "U+200B（零寬空格）：⟦U+200B 零寬空格⟧應手動修改。",
      issueFields: {
        bulletPoints: [true, false, false, false, false],
      },
    };
    const rows: ContentAuditWorkbookV2Row[] = [
      base,
      {
        ...base,
        sellerSku: "FAMILY-B-CHILD",
        asin: "B000000002",
        variationParentSku: "PARENT-B",
        variationFamilyKey: "PARENT-B",
        auditType: "成分宣稱不一致",
        auditDescription: "Amazon ingredients 與標題宣稱不一致。",
        issueFields: { title: true },
      },
      {
        ...base,
        sellerSku: "STANDALONE-ISSUE",
        asin: "B000000003",
        variationRole: "standalone",
        variationParentSku: "",
        variationFamilyKey: "SELF-NOT-A-SHEET",
        variationTheme: "",
      },
      {
        ...base,
        sellerSku: "UNKNOWN-RELATIONSHIP",
        asin: "B000000004",
        variationRole: "unknown",
        variationParentSku: "",
        variationFamilyKey: "UNKNOWN-RELATIONSHIP",
        variationTheme: "",
        auditType: "讀取未完成",
        auditDescription: "relationships missing",
      },
    ];
    const bytes = createContentAuditWorkbookV2({
      marketplaceId: "ATVPDKIKX0DER",
      marketplaceLabel: "US · Amazon.com",
      exportId: "content-audit-v2",
      fetchedAt: "2030-01-02T03:04:05.000Z",
      rows,
    });
    const archive = unzipSync(bytes);
    const workbook = strFromU8(archive["xl/workbook.xml"]!);
    const index = strFromU8(archive["xl/worksheets/sheet1.xml"]!);
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
    expect(index).toContain("Schema Version");
    expect(index).toContain("content-audit-v2");
    expect(index).toContain("只能編輯淺藍色");
    expect(index).toContain("PARENT-A");
    expect(index).toContain("PARENT-B");
    expect(index).toContain("STANDALONE");
    expect(index).toContain("DATA_INCOMPLETE");
    expect(familyA).toContain("FAMILY-A-CHILD");
    expect(familyB).toContain("FAMILY-B-CHILD");
    expect(standalone).toContain("STANDALONE-ISSUE");
    expect(incomplete).toContain("UNKNOWN-RELATIONSHIP");
    expect(familyA).toMatch(/<c r="H2" s="6" t="inlineStr">/u);
    expect(familyA).toMatch(/<c r="I2" s="5" t="inlineStr">/u);
    expect(familyB).toMatch(/<c r="D2" s="6" t="inlineStr">/u);
    expect(familyB).toMatch(/<c r="E2" s="5" t="inlineStr">/u);
    expect(styles).toContain('<fgColor rgb="FFFFF2CC"/>');
    expect(styles).toContain('<fgColor rgb="FFE7E6E6"/>');
    expect(styles).toContain('<fgColor rgb="FFDDEBF7"/>');

    const parsed = parseContentAuditWorkbook({
      bytes,
      fileName: "content-audit.xlsx",
      mediaType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const roundTrip = parsed.rows.find(
      (item) => item.sellerSku === "FAMILY-A-CHILD",
    );
    expect(roundTrip?.original.bulletPoints[0]).toBe(
      "Natural & Gentle\u200b : Only one point",
    );
    expect(roundTrip?.proposed.bulletPoints[0]).toBe(
      "Natural & Gentle\u200b : Only one point",
    );
  });
});
