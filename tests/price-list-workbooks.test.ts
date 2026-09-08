import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { ApiRequest } from "../src/shared/contracts";
import type { PriceListAmazonRow } from "../src/shared/price-list";
import {
  parsePriceListWorkbook,
  exportPriceListWorkbook,
  overlayPriceListWorkbook,
} from "../src/main/price-list-workbook";
import { comparePriceListWorkbooks } from "../src/main/price-list-comparison";
import { PriceListWorkbooks } from "../src/main/price-list-workbooks";

const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
function inline(ref: string, value: string) {
  return `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;
}
function fixture(extra = "", price = "10.99") {
  return zipSync(
    Object.fromEntries(
      Object.entries({
        "[Content_Types].xml":
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>',
        "xl/workbook.xml": `<workbook ${ns} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Brand" sheetId="1" r:id="r1"/></sheets></workbook>`,
        "xl/_rels/workbook.xml.rels":
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Target="worksheets/sheet1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/></Relationships>',
        "xl/worksheets/sheet1.xml": `<worksheet ${ns}><dimension ref="A1:F4"/><cols><col min="1" max="1" width="18"/></cols><sheetData><row r="1">${inline("A1", "Private test template")}</row><row r="3">${["貨號", "圖片", "產品名稱", "ASIN", "最低活動價", "標準定價"].map((h, i) => inline(`${String.fromCharCode(65 + i)}3`, h)).join("")}</row><row r="4" ht="90">${inline("A4", "ITEM-1")}${inline("C4", "Sample Product")}${inline("D4", "B000000001")}<c r="E4"><f>F4*0.7</f><v>7.693</v></c><c r="F4"><v>${price}</v></c></row>${extra}</sheetData><mergeCells count="1"><mergeCell ref="A1:F1"/></mergeCells></worksheet>`,
        "xl/printerSettings/printerSettings1.bin": "inert printer bytes",
      }).map(([path, value]) => [path, strToU8(value)]),
    ),
  );
}
const parse = (bytes: Uint8Array = fixture()) =>
  parsePriceListWorkbook({ bytes, fileName: "test.xlsx" });
function fixtureWithPriceCells(standardCell: string, minimumCell?: string) {
  const archive = unzipSync(fixture());
  let sheet = strFromU8(archive["xl/worksheets/sheet1.xml"]!).replace(
    '<c r="F4"><v>10.99</v></c>',
    standardCell,
  );
  if (minimumCell !== undefined) {
    sheet = sheet.replace(
      '<c r="E4"><f>F4*0.7</f><v>7.693</v></c>',
      minimumCell,
    );
  }
  archive["xl/worksheets/sheet1.xml"] = strToU8(sheet);
  return zipSync(archive);
}
const request = (
  path: string,
  body: ApiRequest["body"],
  query: Record<string, string> = {},
): ApiRequest => ({
  path,
  method: "POST",
  requestId: "test-request",
  headers: {},
  query,
  ...(body ? { body } : {}),
});
const amazon: PriceListAmazonRow = {
  sheetName: "Brand",
  rowNumber: 4,
  sellerSku: "SELLER-1",
  asin: "B000000001",
  status: "matched",
  message: "核對完成",
  standardPrice: 12,
  minimumPrice: 8,
  minimumPriceStatus: "set",
  imageUrl: null,
  currency: "USD",
  fetchedAt: "2026-09-08T10:00:00Z",
};

describe("local price-list public seams", () => {
  it("keeps original workbook bytes, exact cells, formulas and print settings", () => {
    const bytes = fixture();
    const book = parse(bytes);
    expect(book.view.products).toHaveLength(1);
    expect(book.view.products[0]).toMatchObject({
      key: "ITEM-1",
      keyKind: "product-code",
      asin: "B000000001",
      rowNumber: 4,
      cells: {
        standardPrice: { value: 10.99, reference: "F4" },
        minimumPrice: { formula: "F4*0.7", value: 7.693 },
      },
    });
    expect(book.view.sheets[0]!.merges[0]).toEqual({
      startRow: 1,
      endRow: 1,
      startColumn: 1,
      endColumn: 6,
    });
    expect(exportPriceListWorkbook(book)).toEqual(bytes);
    expect(book.view.sheets[0]!.rowHeights[4]).toBe(120);
  });
  it("compares exact keys and cell locations, without positional matching", () => {
    const base = parse();
    const candidate = parse(fixture("", "12.99"));
    const difference = comparePriceListWorkbooks(base.view, candidate.view);
    expect(difference.counts).toMatchObject({ changed: 1, unchanged: 0 });
    expect(difference.rows[0]!.fields[0]).toMatchObject({
      field: "標準定價",
      delta: 2,
      beforeCell: "Brand!F4",
      afterCell: "Brand!F4",
    });
    const duplicate = parse(
      fixture(
        `<row r="5">${inline("A5", "ITEM-1")}${inline("C5", "Duplicate")}</row>`,
      ),
    );
    expect(
      comparePriceListWorkbooks(base.view, duplicate.view).rows[0]!.status,
    ).toBe("duplicate");
  });
  it("distinguishes added, removed, numeric zero and empty prices", () => {
    const base = parse();
    const candidate = parse();
    candidate.view.products[0]!.key = "ITEM-2";
    expect(
      comparePriceListWorkbooks(base.view, candidate.view).counts,
    ).toMatchObject({ added: 1, removed: 1 });
    candidate.view.products[0]!.key = "ITEM-1";
    candidate.view.products[0]!.cells.standardPrice!.value = 0;
    base.view.products[0]!.cells.standardPrice!.value = null;
    expect(
      comparePriceListWorkbooks(base.view, candidate.view).counts.changed,
    ).toBe(1);
  });
  it("exports Amazon paired columns while preserving original values, formulas and package parts", () => {
    const book = parse();
    const output = overlayPriceListWorkbook(book, [amazon]);
    const exported = parse(output);
    expect(exported.view.products[0]!.cells.standardPrice!.value).toBe(10.99);
    expect(exported.view.products[0]!.cells.minimumPrice!.formula).toBe(
      "F4*0.7",
    );
    expect(
      exported.view.sheets[0]!.cells.find((cell) => cell.reference === "G4")!
        .value,
    ).toBe(12);
    expect(
      exported.view.sheets[0]!.cells.find((cell) => cell.reference === "H4")!
        .value,
    ).toBe(8);
    expect(
      unzipSync(output)["xl/printerSettings/printerSettings1.bin"],
    ).toEqual(book.archive["xl/printerSettings/printerSettings1.bin"]);
    expect(exportPriceListWorkbook(book)).toEqual(fixture());
  });
  it("exports unset minimum explicitly and does not write fake zero deltas", () => {
    const output = parse(
      overlayPriceListWorkbook(parse(), [
        { ...amazon, minimumPrice: null, minimumPriceStatus: "not-set" },
      ]),
    );
    expect(
      output.view.sheets[0]!.cells.find((cell) => cell.reference === "H4")!
        .value,
    ).toBe("未設定");
    expect(
      output.view.sheets[0]!.cells.find((cell) => cell.reference === "J4")!
        .value,
    ).toBeNull();
  });
  it("exports a delta for a shared-string price without changing its source type or formula", () => {
    const archive = unzipSync(fixture());
    archive["xl/sharedStrings.xml"] = strToU8(
      `<sst ${ns}><si><t>10.99</t></si></sst>`,
    );
    archive["xl/worksheets/sheet1.xml"] = strToU8(
      strFromU8(archive["xl/worksheets/sheet1.xml"]!).replace(
        '<c r="F4"><v>10.99</v></c>',
        '<c r="F4" t="s"><v>0</v></c>',
      ),
    );
    const bytes = zipSync(archive);
    const book = parse(bytes);
    const output = parse(overlayPriceListWorkbook(book, [amazon]));
    expect(
      output.view.sheets[0]!.cells.find((entry) => entry.reference === "I4")!
        .value,
    ).toBe(1.01);
    expect(output.view.products[0]!.cells.standardPrice!.value).toBe("10.99");
    expect(output.view.products[0]!.cells.minimumPrice).toMatchObject({
      formula: "F4*0.7",
      value: 7.693,
    });
    expect(exportPriceListWorkbook(book)).toEqual(bytes);
    expect(
      comparePriceListWorkbooks(book.view, parse().view).counts.changed,
    ).toBe(1);
  });
  it.each([
    "9007199254740990.9",
    "9007199254740991.01",
    "17.99000000000000001",
  ])(
    "keeps precision-losing decimal text %s out of exported deltas",
    (price) => {
      const archive = unzipSync(fixture());
      archive["xl/worksheets/sheet1.xml"] = strToU8(
        strFromU8(archive["xl/worksheets/sheet1.xml"]!).replace(
          '<c r="F4"><v>10.99</v></c>',
          inline("F4", price),
        ),
      );
      const output = parse(
        overlayPriceListWorkbook(parse(zipSync(archive)), [amazon]),
      );
      expect(
        output.view.sheets[0]!.cells.find((entry) => entry.reference === "I4")!
          .value,
      ).toBeNull();
      expect(output.view.products[0]!.cells.standardPrice!.value).toBe(price);
    },
  );
  it.each(["0", "000.00", "10.99000", "00010.990000"])(
    "uses decimal text %s for both price deltas without rewriting it",
    (price) => {
      const bytes = fixtureWithPriceCells(
        inline("F4", price),
        inline("E4", "7.693"),
      );
      const book = parse(bytes);
      const output = parse(overlayPriceListWorkbook(book, [amazon]));
      expect(
        output.view.sheets[0]!.cells.find((entry) => entry.reference === "I4")!
          .value,
      ).toBe(price === "0" || price === "000.00" ? 12 : 1.01);
      expect(
        output.view.sheets[0]!.cells.find((entry) => entry.reference === "J4")!
          .value,
      ).toBe(0.307);
      expect(output.view.products[0]!.cells.standardPrice!.value).toBe(price);
      expect(output.view.products[0]!.cells.minimumPrice!.value).toBe("7.693");
      expect(exportPriceListWorkbook(book)).toEqual(bytes);
    },
  );
  it.each([
    "",
    " ",
    "10.99\n",
    "10.99\r\n",
    "17\n99",
    "$10.99",
    "10.99 USD",
    "1,099",
    "10,99",
    "0x11",
    "1e2",
    "NaN",
    "Infinity",
    "-1",
    "=1+2",
    "9007199254740993",
  ])("keeps ambiguous or invalid price text %j out of both deltas", (price) => {
    const bytes = fixtureWithPriceCells(
      inline("F4", price),
      inline("E4", price),
    );
    const book = parse(bytes);
    const output = parse(overlayPriceListWorkbook(book, [amazon]));
    for (const reference of ["I4", "J4"]) {
      expect(
        output.view.sheets[0]!.cells.find(
          (entry) => entry.reference === reference,
        )!.value,
      ).toBeNull();
    }
    expect(exportPriceListWorkbook(book)).toEqual(bytes);
  });
  it.each([
    '<c r="F4" t="b"><v>1</v></c>',
    '<c r="F4"><f>UNSUPPORTED(1)</f></c>',
  ])(
    "does not infer a price from a boolean or an uncached formula",
    (standard) => {
      const bytes = fixtureWithPriceCells(standard);
      const book = parse(bytes);
      const output = parse(overlayPriceListWorkbook(book, [amazon]));
      expect(
        output.view.sheets[0]!.cells.find((entry) => entry.reference === "I4")!
          .value,
      ).toBeNull();
      expect(exportPriceListWorkbook(book)).toEqual(bytes);
    },
  );
  it("exports numeric zero deltas when decimal-text prices equal Amazon", () => {
    const book = parse(
      fixtureWithPriceCells(inline("F4", "12.00"), inline("E4", "8.00")),
    );
    const output = parse(overlayPriceListWorkbook(book, [amazon]));
    for (const reference of ["I4", "J4"]) {
      expect(
        output.view.sheets[0]!.cells.find(
          (entry) => entry.reference === reference,
        )!.value,
      ).toBe(0);
    }
  });
  it("compares a formula's cached decimal text without evaluating or changing the formula", () => {
    const bytes = fixtureWithPriceCells(
      '<c r="F4" t="str"><f>UNSUPPORTED(1)</f><v>10.99</v></c>',
    );
    const book = parse(bytes);
    const output = parse(overlayPriceListWorkbook(book, [amazon]));
    expect(
      output.view.sheets[0]!.cells.find((entry) => entry.reference === "I4")!
        .value,
    ).toBe(1.01);
    expect(output.view.products[0]!.cells.standardPrice).toMatchObject({
      value: "10.99",
      formula: "UNSUPPORTED(1)",
    });
    expect(exportPriceListWorkbook(book)).toEqual(bytes);
  });
  it("adds Amazon image anchors without requiring rich data or changing product text", () => {
    const output = overlayPriceListWorkbook(parse(), [amazon], {
      imageReplacements: [
        {
          sheetName: "Brand",
          rowNumber: 4,
          bytes: new Uint8Array([
            137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0,
            0, 1, 0, 0, 0, 2,
          ]),
          mediaType: "image/png",
        },
      ],
    });
    const archive = unzipSync(output);
    expect(strFromU8(archive["xl/drawings/price-list-0.xml"]!)).toContain(
      "Amazon main image 1",
    );
    expect(strFromU8(archive["xl/worksheets/sheet1.xml"]!)).toContain(
      "Sample Product",
    );
    expect(
      archive[
        Object.keys(archive).find((path) =>
          path.startsWith("xl/media/price-list-amazon-"),
        )!
      ],
    ).toEqual(
      new Uint8Array([
        137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0,
        1, 0, 0, 0, 2,
      ]),
    );
    expect(
      parse(output).view.sheets[0]!.cells.find(
        (cell) => cell.reference === "B4",
      )!.imageId,
    ).toBeTruthy();
  });
  it("stores repeated Amazon image bytes once across different product rows", () => {
    const book = parse(
      fixture(
        `<row r="5">${inline("A5", "ITEM-2")}${inline("C5", "Another product")}</row>`,
      ),
    );
    const bytes = new Uint8Array([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1,
      0, 0, 0, 2,
    ]);
    const output = overlayPriceListWorkbook(
      book,
      [amazon, { ...amazon, rowNumber: 5 }],
      {
        imageReplacements: [4, 5].map((rowNumber) => ({
          sheetName: "Brand",
          rowNumber,
          bytes,
          mediaType: "image/png",
        })),
      },
    );
    const archive = unzipSync(output);
    expect(
      Object.keys(archive).filter((path) =>
        path.startsWith("xl/media/price-list-amazon-"),
      ),
    ).toHaveLength(1);
    expect(
      strFromU8(archive["xl/drawings/price-list-0.xml"]!).match(
        /<xdr:oneCellAnchor/gu,
      ),
    ).toHaveLength(2);
  });
  it("rejects invalid or oversized decoded images before returning them to the viewer", () => {
    const bytes = new Uint8Array([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1,
      0, 0, 0, 2,
    ]);
    const output = overlayPriceListWorkbook(parse(), [amazon], {
      imageReplacements: [
        { sheetName: "Brand", rowNumber: 4, bytes, mediaType: "image/png" },
      ],
    });
    const archive = unzipSync(output);
    const imagePath = Object.keys(archive).find((path) =>
      path.startsWith("xl/media/price-list-amazon-"),
    )!;
    archive[imagePath] = new Uint8Array([1, 2, 3]);
    expect(() => parse(zipSync(archive))).toThrow(/無效圖片/u);
    archive[imagePath] = bytes.slice();
    new DataView(archive[imagePath].buffer).setUint32(16, 100_000);
    new DataView(archive[imagePath].buffer).setUint32(20, 100_000);
    expect(() => parse(zipSync(archive))).toThrow(/像素/u);
  });
  it("rejects sparse worksheets with excessive rendered dimensions", () => {
    expect(() =>
      parse(
        fixture(`<row r="5000">${inline("DX5000", "wide sparse cell")}</row>`),
      ),
    ).toThrow(/空白範圍/u);
  });
  it("rejects executable packages and XML entities, but does not execute formula text", () => {
    const archive = unzipSync(fixture());
    archive["xl/vbaProject.bin"] = new Uint8Array([1]);
    expect(() => parse(zipSync(archive))).toThrow(/巨集/u);
    delete archive["xl/vbaProject.bin"];
    archive["xl/workbook.xml"] = strToU8(
      '<!DOCTYPE x [<!ENTITY entity SYSTEM "file:///tmp/private">]><workbook/>',
    );
    expect(() => parse(zipSync(archive))).toThrow(/XML 宣告/u);
    expect(parse().view.formulaCount).toBe(1);
  });
  it("uses opaque main-owned handles, expires them and never accepts a file path", () => {
    let now = 1000;
    const service = new PriceListWorkbooks(() => now);
    const view = service.import({ bytes: fixture(), fileName: "test.xlsx" });
    expect(view.id).toMatch(/^price-list\./u);
    expect(
      service.route(
        request("/api/price-list/import", {
          kind: "json",
          value: { path: "/tmp/test.xlsx" },
        }),
      )!.status,
    ).toBe(400);
    expect(service.export(view.id)).toEqual(fixture());
    now += 8 * 60 * 60_000;
    expect(() => service.get(view.id)).toThrow(/過期/u);
    expect(
      service.route(
        request("/api/price-list/compare", {
          kind: "json",
          value: { baseId: view.id, candidateId: view.id },
        }),
      )!.status,
    ).toBe(404);
  });
});
