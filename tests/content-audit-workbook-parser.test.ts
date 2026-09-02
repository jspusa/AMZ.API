import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  ContentAuditWorkbookError,
  parseContentAuditWorkbook,
} from "../src/main/amazon/content-audit-workbook-parser";
import {
  createContentAuditWorkbookV2,
  type ContentAuditWorkbookV2Row,
} from "../src/main/amazon/xlsx";

const MEDIA_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function availableSoffice(): string | null {
  for (const command of ["soffice", "libreoffice"]) {
    const result = spawnSync(command, ["--version"], {
      encoding: "utf8",
      timeout: 10_000,
    });
    if (result.status === 0) return command;
  }
  return null;
}

const soffice = availableSoffice();
const libreOfficeTest = soffice ? it : it.skip;

function auditRow(
  sellerSku: string,
  overrides: Partial<ContentAuditWorkbookV2Row> = {},
): ContentAuditWorkbookV2Row {
  return {
    sellerSku,
    asin: "B000000001",
    productType: "PET_FOOD",
    title: "=Literal title, not a formula",
    itemHighlight: "Original highlight",
    bulletPoints: ["One", "Two", "Three", "Four", "Five"],
    productDescription: "Original description",
    ingredients: "Turkey",
    variationRole: "child",
    variationParentSku: "PARENT-A",
    variationFamilyKey: "PARENT-A",
    variationTheme: "SIZE_NAME",
    auditType: "產品亮點過短 · 產品亮點",
    auditDescription: "[產品亮點過短] 目前 18 字元，低於 115 字元。",
    issueFields: { itemHighlight: true },
    ...overrides,
  };
}

function workbook(rows: readonly ContentAuditWorkbookV2Row[]): Uint8Array {
  return createContentAuditWorkbookV2({
    marketplaceId: "ATVPDKIKX0DER",
    marketplaceLabel: "US · Amazon.com",
    exportId: "roundtrip-export-1",
    fetchedAt: "2026-08-22T01:02:03.000Z",
    rows,
  });
}

function parse(bytes: Uint8Array) {
  return parseContentAuditWorkbook({
    bytes,
    fileName: "content-audit.xlsx",
    mediaType: MEDIA_TYPE,
  });
}

function mutateArchive(
  bytes: Uint8Array,
  mutate: (archive: Record<string, Uint8Array>) => void,
): Uint8Array {
  const archive = unzipSync(bytes);
  mutate(archive);
  return zipSync(archive, { level: 6 });
}

function replacePart(
  archive: Record<string, Uint8Array>,
  name: string,
  replace: (xml: string) => string,
): void {
  const value = archive[name];
  if (!value) throw new Error(`Missing test part ${name}`);
  archive[name] = strToU8(replace(strFromU8(value)));
}

function replaceCell(
  xml: string,
  reference: string,
  replacement: string,
): string {
  const expression = new RegExp(`<c r="${reference}"[^>]*>.*?<\\/c>`, "su");
  if (!expression.test(xml)) throw new Error(`Missing test cell ${reference}`);
  return xml.replace(expression, replacement);
}

function keepWorkbookSheets(
  bytes: Uint8Array,
  sheetNames: readonly string[],
): Uint8Array {
  return mutateArchive(bytes, (archive) => {
    replacePart(archive, "xl/workbook.xml", (xml) => {
      const selected = [...xml.matchAll(/<sheet name="([^"]+)"[^>]*\/>/gu)]
        .filter((match) => sheetNames.includes(match[1] ?? ""))
        .map((match) => match[0]);
      if (selected.length !== sheetNames.length) {
        throw new Error("Missing selected workbook sheets");
      }
      return xml.replace(
        /<sheets>.*?<\/sheets>/su,
        `<sheets>${selected.join("")}</sheets>`,
      );
    });
  });
}

function removeEmbeddedSheetMetadata(xml: string): string {
  return xml
    .replace(/<c r="X1"[^>]*>.*?<\/c>/su, "")
    .replace(/<c r="Y1"[^>]*>.*?<\/c>/su, "")
    .replace(/<col min="24" max="25"[^>]*\/>/u, "")
    .replace(/<dimension ref="A1:Y(\d+)"\/>/u, '<dimension ref="A1:W$1"/>');
}

function expectWorkbookError(
  action: () => unknown,
  expected: { code: string; status: number },
): void {
  try {
    action();
    throw new Error("Expected ContentAuditWorkbookError");
  } catch (error) {
    expect(error).toBeInstanceOf(ContentAuditWorkbookError);
    expect(error).toMatchObject(expected);
  }
}

describe("content audit workbook parser", () => {
  it("preserves XML line-break code points in immutable and proposed cells", () => {
    const separators = "CR:\r NEL:\u0085 LS:\u2028 PS:\u2029";
    const bytes = workbook([auditRow("LINE-BREAKS-1", {
      bulletPoints: [separators, "Two", "Three", "Four", "Five"],
    })]);
    const worksheet = strFromU8(unzipSync(bytes)["xl/worksheets/sheet2.xml"]!);
    expect(worksheet).toContain("&#xD;");
    expect(worksheet).toContain("&#x85;");
    expect(worksheet).toContain("&#x2028;");
    expect(worksheet).toContain("&#x2029;");
    const result = parse(bytes);

    expect(result.rows[0]?.original.bulletPoints[0]).toBe(separators);
    expect(result.rows[0]?.proposed.bulletPoints[0]).toBe(separators);
  });

  it("rejects content-audit cells that OOXML cannot preserve losslessly", () => {
    expect(() => workbook([auditRow("INVALID-CONTROL-1", {
      title: "Unsafe\u000btitle",
    })])).toThrow(/cannot preserve losslessly/u);
    expect(() => workbook([auditRow("OVERSIZED-CELL-1", {
      productDescription: "A".repeat(32_768),
    })])).toThrow(/lossless cell limit/u);
  });

  it("round-trips source values, proposed edits, metadata and fail-closed grouping", () => {
    const bytes = workbook([
      auditRow("CHILD-1", {
        variationParentSku: "+PARENT-A",
        variationFamilyKey: "=PARENT-A",
        variationTheme: "@SIZE_NAME",
      }),
      auditRow("STANDALONE-1", {
        asin: "B000000002",
        variationRole: "standalone",
        variationParentSku: "",
        variationFamilyKey: "SELF-KEY-MUST-NOT-BECOME-A-SHEET",
        variationTheme: "",
      }),
      auditRow("UNKNOWN-1", {
        asin: "B000000003",
        variationRole: "unknown",
        variationParentSku: "",
        variationFamilyKey: "UNKNOWN-1",
        variationTheme: "",
      }),
    ]);
    const sourceArchive = unzipSync(bytes);
    const indexXml = strFromU8(sourceArchive["xl/worksheets/sheet1.xml"]!);
    const familyXml = strFromU8(sourceArchive["xl/worksheets/sheet2.xml"]!);
    expect(indexXml).toContain("=PARENT-A");
    expect(indexXml).toContain("+PARENT-A");
    expect(indexXml).toContain("@SIZE_NAME");
    expect(indexXml).not.toContain("&apos;=PARENT-A");
    expect(indexXml).not.toContain("&apos;+PARENT-A");
    expect(indexXml).not.toContain("&apos;@SIZE_NAME");
    expect(familyXml).toContain('t="inlineStr"');
    expect(familyXml).toContain("=Literal title, not a formula");
    expect(familyXml).not.toContain("<f>");
    for (const [name, part] of Object.entries(sourceArchive)) {
      if (name.startsWith("xl/worksheets/") && name.endsWith(".xml")) {
        expect(strFromU8(part)).not.toContain("<autoFilter");
      }
    }
    const edited = mutateArchive(bytes, (archive) => {
      replacePart(archive, "xl/worksheets/sheet2.xml", (xml) =>
        replaceCell(
          xml,
          "E2",
          '<c r="E2" s="7" t="inlineStr"><is><t xml:space="preserve">Updated title</t></is></c>',
        ));
    });

    const result = parse(edited);
    expect(result.metadata).toEqual({
      schemaVersion: 2,
      marketplaceId: "ATVPDKIKX0DER",
      exportId: "roundtrip-export-1",
      fetchedAt: "2026-08-22T01:02:03.000Z",
    });
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]).toMatchObject({
      sellerSku: "CHILD-1",
      variationFamilyKey: "=PARENT-A",
      sourceSheet: "F001",
      original: {
        title: "=Literal title, not a formula",
        itemHighlight: "Original highlight",
        bulletPoints: ["One", "Two", "Three", "Four", "Five"],
        productDescription: "Original description",
        ingredients: "Turkey",
      },
      proposed: { title: "Updated title" },
      title: "Updated title",
    });
    expect(result.rows.find((row) => row.sellerSku === "STANDALONE-1")).toMatchObject({
      variationFamilyKey: "STANDALONE",
      sourceSheet: "未綁變體",
    });
    expect(result.rows.find((row) => row.sellerSku === "UNKNOWN-1")).toMatchObject({
      variationFamilyKey: "DATA_INCOMPLETE",
      sourceSheet: "資料未完成",
    });
  });

  it("accepts one copied family worksheet and ignores every omitted family", () => {
    const source = workbook([
      auditRow("FAMILY-A-1"),
      auditRow("FAMILY-B-1", {
        asin: "B000000002",
        variationParentSku: "PARENT-B",
        variationFamilyKey: "PARENT-B",
      }),
    ]);
    const partial = mutateArchive(keepWorkbookSheets(source, ["F002"]), (archive) => {
      replacePart(archive, "xl/worksheets/sheet3.xml", (xml) =>
        replaceCell(
          xml,
          "E2",
          '<c r="E2" s="7" t="inlineStr"><is><t xml:space="preserve">Only F002 changed</t></is></c>',
        ));
    });

    const result = parse(partial);

    expect(result.metadata).toEqual({
      schemaVersion: 2,
      marketplaceId: "ATVPDKIKX0DER",
      exportId: "roundtrip-export-1",
      fetchedAt: "2026-08-22T01:02:03.000Z",
    });
    expect(result.rows).toEqual([
      expect.objectContaining({
        sellerSku: "FAMILY-B-1",
        variationFamilyKey: "PARENT-B",
        sourceSheet: "F002",
        proposed: expect.objectContaining({ title: "Only F002 changed" }),
      }),
    ]);
  });

  it("accepts the index sheet left beside one selected family worksheet", () => {
    const source = workbook([
      auditRow("FAMILY-A-1"),
      auditRow("FAMILY-B-1", {
        asin: "B000000002",
        variationParentSku: "PARENT-B",
        variationFamilyKey: "PARENT-B",
      }),
    ]);

    const result = parse(keepWorkbookSheets(source, ["說明與索引", "F002"]));

    expect(result.rows).toEqual([
      expect.objectContaining({
        sellerSku: "FAMILY-B-1",
        variationFamilyKey: "PARENT-B",
        sourceSheet: "F002",
      }),
    ]);
  });

  it("accepts two copied family worksheets from the same export", () => {
    const source = workbook([
      auditRow("FAMILY-A-1"),
      auditRow("FAMILY-B-1", {
        asin: "B000000002",
        variationParentSku: "PARENT-B",
        variationFamilyKey: "PARENT-B",
      }),
      auditRow("FAMILY-C-1", {
        asin: "B000000003",
        variationParentSku: "PARENT-C",
        variationFamilyKey: "PARENT-C",
      }),
    ]);

    const result = parse(keepWorkbookSheets(source, ["F001", "F003"]));

    expect(result.rows.map((row) => row.sourceSheet)).toEqual(["F001", "F003"]);
    expect(result.rows.map((row) => row.sellerSku)).toEqual([
      "FAMILY-A-1",
      "FAMILY-C-1",
    ]);
  });

  it("rejects duplicate family identity across partial worksheets", () => {
    const source = workbook([
      auditRow("FAMILY-A-1"),
      auditRow("FAMILY-B-1", {
        asin: "B000000002",
        variationParentSku: "PARENT-B",
        variationFamilyKey: "PARENT-B",
      }),
    ]);
    const duplicated = mutateArchive(
      keepWorkbookSheets(source, ["F001", "F002"]),
      (archive) => {
        replacePart(archive, "xl/worksheets/sheet3.xml", (xml) =>
          xml.replace("PARENT-B", "PARENT-A"));
      },
    );

    expect(() => parse(duplicated)).toThrow(/重複的變體家庭工作表/u);
  });

  it("keeps accepting complete legacy v2 workbooks without embedded sheet metadata", () => {
    const legacy = mutateArchive(workbook([auditRow("LEGACY-1")]), (archive) => {
      replacePart(archive, "xl/worksheets/sheet2.xml", removeEmbeddedSheetMetadata);
    });

    expect(parse(legacy).rows).toEqual([
      expect.objectContaining({ sellerSku: "LEGACY-1", sourceSheet: "F001" }),
    ]);
  });

  it("rejects a partial legacy sheet that has no safe snapshot identity", () => {
    const legacyPartial = mutateArchive(
      keepWorkbookSheets(workbook([auditRow("LEGACY-PARTIAL-1")]), ["F001"]),
      (archive) => {
        replacePart(archive, "xl/worksheets/sheet2.xml", removeEmbeddedSheetMetadata);
      },
    );

    expect(() => parse(legacyPartial)).toThrow(/缺少來源識別.*新版 AMZ\.API/u);
  });

  it("rejects formulas, macros, external relationships and defined names", () => {
    const source = workbook([auditRow("CHILD-1")]);
    const formula = mutateArchive(source, (archive) => {
      replacePart(archive, "xl/worksheets/sheet2.xml", (xml) =>
        replaceCell(xml, "E2", '<c r="E2"><f>1+1</f><v>2</v></c>'));
    });
    expectWorkbookError(() => parse(formula), {
      code: "CONTENT_AUDIT_WORKBOOK_UNSAFE",
      status: 422,
    });

    const macro = mutateArchive(source, (archive) => {
      archive["xl/vbaProject.bin"] = new Uint8Array([1, 2, 3]);
    });
    expectWorkbookError(() => parse(macro), {
      code: "CONTENT_AUDIT_WORKBOOK_UNSAFE",
      status: 422,
    });

    const external = mutateArchive(source, (archive) => {
      replacePart(archive, "_rels/.rels", (xml) =>
        xml.replace(
          "</Relationships>",
          '<Relationship Id="evil" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.invalid" TargetMode="External"/></Relationships>',
        ));
    });
    expectWorkbookError(() => parse(external), {
      code: "CONTENT_AUDIT_WORKBOOK_UNSAFE",
      status: 422,
    });

    const definedName = mutateArchive(source, (archive) => {
      replacePart(archive, "xl/workbook.xml", (xml) =>
        xml.replace(
          "</workbook>",
          "<definedNames><definedName name=\"_xlnm._FilterDatabase\" hidden=\"1\" localSheetId=\"1\">F001!$A$1:$W$2</definedName></definedNames></workbook>",
        ));
    });
    expectWorkbookError(() => parse(definedName), {
      code: "CONTENT_AUDIT_WORKBOOK_UNSAFE",
      status: 422,
    });
  });

  it("identifies the worksheet, name and reference for rejected Defined Names", () => {
    const source = workbook([auditRow("CHILD-1")]);
    const definedName = mutateArchive(source, (archive) => {
      replacePart(archive, "xl/workbook.xml", (xml) =>
        xml.replace(
          "</workbook>",
          '<definedNames><definedName name="_xlnm._FilterDatabase" hidden="1" localSheetId="1">F001!$A$1:$W$2</definedName></definedNames></workbook>',
        ));
    });

    expect(() => parse(definedName)).toThrowError(
      /工作表「F001」.*名稱「_xlnm\._FilterDatabase」.*指向「F001!\$A\$1:\$W\$2」/u,
    );
  });

  it("bounds Defined Name diagnostics and identifies workbook-scoped names", () => {
    const source = workbook([auditRow("CHILD-1")]);
    const names = Array.from({ length: 10 }, (_, index) =>
      `<definedName name="Range_${index + 1}"${
        index === 0 ? "" : ' localSheetId="1"'
      }>${index === 0 ? "F001!$A$1" : `F001!$A$${index + 1}`}</definedName>`
    ).join("");
    const definedNames = mutateArchive(source, (archive) => {
      replacePart(archive, "xl/workbook.xml", (xml) =>
        xml.replace(
          "</workbook>",
          `<definedNames>${names}</definedNames></workbook>`,
        ));
    });

    let message = "";
    try {
      parse(definedNames);
    } catch (error) {
      expect(error).toBeInstanceOf(ContentAuditWorkbookError);
      message = (error as Error).message;
    }
    expect(message).toMatch(
      /10 個 Defined Name.*1\. 整份活頁簿｜名稱「Range_1」.*8\. 工作表「F001」｜名稱「Range_8」.*另有 2 個未列出.*公式 > 名稱管理員/su,
    );
    expect(message).not.toMatch(/Range_9|Range_10/u);
  });

  it("removes bidi isolates and invisible controls from Defined Name diagnostics", () => {
    const source = workbook([auditRow("CHILD-1")]);
    const definedName = mutateArchive(source, (archive) => {
      replacePart(archive, "xl/workbook.xml", (xml) =>
        xml.replace(
          "</workbook>",
          '<definedNames><definedName name="Safe&#x2066;Name&#x2069;&#xAD;&#x34F;&#x61C;" localSheetId="1">F001!&#x2066;$A$1&#x2069;</definedName></definedNames></workbook>',
        ));
    });

    expect(() => parse(definedName)).toThrowError(
      /工作表「F001」｜名稱「Safe Name」｜指向「F001! \$A\$1」/u,
    );
    try {
      parse(definedName);
    } catch (error) {
      expect((error as Error).message).not.toMatch(
        /[\u00ad\u034f\u061c\u2066-\u2069]/u,
      );
    }
  });

  it("rejects unknown columns and reports every duplicate SKU row", () => {
    const source = workbook([
      auditRow("CHILD-1"),
      auditRow("CHILD-2", { asin: "B000000002" }),
    ]);
    const unknownColumn = mutateArchive(source, (archive) => {
      replacePart(archive, "xl/worksheets/sheet2.xml", (xml) =>
        xml.replace(
          "</row>",
          '<c r="X1" t="inlineStr"><is><t>未知欄</t></is></c></row>',
        ));
    });
    expectWorkbookError(() => parse(unknownColumn), {
      code: "CONTENT_AUDIT_WORKBOOK_SCHEMA_INVALID",
      status: 422,
    });

    const duplicateSku = mutateArchive(source, (archive) => {
      replacePart(archive, "xl/worksheets/sheet2.xml", (xml) =>
        xml.replace("CHILD-2", "CHILD-1"));
    });
    const duplicateResult = parse(duplicateSku);
    expect(duplicateResult.rows).toEqual([]);
    expect(duplicateResult.issues).toEqual([
      expect.objectContaining({
        code: "SELLER_SKU_DUPLICATE",
        sellerSku: "CHILD-1",
        rowNumber: 2,
        fieldLabel: "Seller SKU",
      }),
      expect.objectContaining({
        code: "SELLER_SKU_DUPLICATE",
        sellerSku: "CHILD-1",
        rowNumber: 3,
        fieldLabel: "Seller SKU",
      }),
    ]);
  });

  it("reports every editable row problem with its SKU and field in one pass", () => {
    const source = workbook([
      auditRow("BAD-ASIN", { asin: "NOT-AN-ASIN" }),
      auditRow("BAD-PRODUCT-TYPE", {
        asin: "B000000002",
        productType: "P".repeat(201),
      }),
    ]);

    const result = parse(source);

    expect(result.rows).toEqual([]);
    expect(result.issues).toEqual([
      {
        code: "ASIN_INVALID",
        sellerSku: "BAD-ASIN",
        sourceSheet: "F001",
        rowNumber: 2,
        field: "asin",
        fieldLabel: "ASIN",
        message: "ASIN 格式無效，應為 10 碼英文字母或數字。",
      },
      {
        code: "PRODUCT_TYPE_TOO_LONG",
        sellerSku: "BAD-PRODUCT-TYPE",
        sourceSheet: "F001",
        rowNumber: 3,
        field: "productType",
        fieldLabel: "Product Type",
        message: "Product Type 超過 200 字元。",
      },
    ]);
  });

  it("isolates every duplicate occurrence even when one duplicate row has another invalid field", () => {
    const source = workbook([
      auditRow("DUPLICATE-WITH-BAD-ASIN", { asin: "NOT-AN-ASIN" }),
      auditRow("SECOND-SKU", { asin: "B000000002" }),
    ]);
    const duplicate = mutateArchive(source, (archive) => {
      replacePart(archive, "xl/worksheets/sheet2.xml", (xml) =>
        xml.replace("SECOND-SKU", "DUPLICATE-WITH-BAD-ASIN"));
    });

    const result = parse(duplicate);

    expect(result.rows).toEqual([]);
    expect(result.issues).toHaveLength(3);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "ASIN_INVALID",
        sellerSku: "DUPLICATE-WITH-BAD-ASIN",
        rowNumber: 2,
      }),
      expect.objectContaining({
        code: "SELLER_SKU_DUPLICATE",
        sellerSku: "DUPLICATE-WITH-BAD-ASIN",
        rowNumber: 2,
      }),
      expect.objectContaining({
        code: "SELLER_SKU_DUPLICATE",
        sellerSku: "DUPLICATE-WITH-BAD-ASIN",
        rowNumber: 3,
      }),
    ]));
  });

  it("rejects non-xlsx uploads and oversized uncompressed XML", () => {
    const source = workbook([auditRow("CHILD-1")]);
    expectWorkbookError(
      () =>
        parseContentAuditWorkbook({
          bytes: source,
          fileName: "content-audit.csv",
          mediaType: "text/csv",
        }),
      {
        code: "CONTENT_AUDIT_WORKBOOK_MEDIA_TYPE_INVALID",
        status: 415,
      },
    );

    const oversized = mutateArchive(source, (archive) => {
      archive["xl/theme/huge.xml"] = new Uint8Array(16 * 1024 * 1024 + 1);
    });
    expectWorkbookError(() => parse(oversized), {
      code: "CONTENT_AUDIT_WORKBOOK_TOO_LARGE",
      status: 413,
    });
  });

  libreOfficeTest(
    "survives a real LibreOffice open/save round-trip without Defined Names",
    () => {
      const temporaryDirectory = mkdtempSync(
        join(tmpdir(), "amz-api-content-audit-"),
      );
      const inputDirectory = join(temporaryDirectory, "input");
      const outputDirectory = join(temporaryDirectory, "output");
      const profileDirectory = join(temporaryDirectory, "profile");
      mkdirSync(inputDirectory);
      mkdirSync(outputDirectory);
      mkdirSync(profileDirectory);
      const inputPath = join(inputDirectory, "roundtrip.xlsx");
      const outputPath = join(outputDirectory, "roundtrip.xlsx");
      try {
        writeFileSync(
          inputPath,
          workbook([
            auditRow("LIBREOFFICE-1", {
              variationParentSku: "+PARENT-LIBREOFFICE",
              variationFamilyKey: "=PARENT-LIBREOFFICE",
              variationTheme: "@SIZE_NAME",
            }),
          ]),
        );
        const result = spawnSync(
          soffice!,
          [
            `-env:UserInstallation=${pathToFileURL(profileDirectory).href}`,
            "--headless",
            "--convert-to",
            "xlsx",
            "--outdir",
            outputDirectory,
            inputPath,
          ],
          { encoding: "utf8", timeout: 30_000 },
        );
        expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
        const saved = new Uint8Array(readFileSync(outputPath));
        const savedArchive = unzipSync(saved);
        const workbookXml = strFromU8(savedArchive["xl/workbook.xml"]!);
        expect(workbookXml).not.toContain("definedName");
        const parsed = parse(saved);
        expect(parsed.rows[0]).toMatchObject({
          sellerSku: "LIBREOFFICE-1",
          variationFamilyKey: "=PARENT-LIBREOFFICE",
          original: { title: "=Literal title, not a formula" },
          proposed: { title: "=Literal title, not a formula" },
        });
      } finally {
        rmSync(temporaryDirectory, { recursive: true, force: true });
      }
    },
    45_000,
  );
});
