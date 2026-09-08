import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import PriceListPanel, {
  priceListAmazonDifference,
} from "../src/renderer/src/components/price-list-panel";
import type {
  PriceListAmazonRow,
  PriceListCell,
  PriceListProductRow,
  PriceListWorkbook,
} from "../src/shared/price-list";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const cell = (
  reference: string,
  column: number,
  value: string | number,
): PriceListCell => ({
  reference,
  row: 2,
  column,
  value,
  display: String(value),
  formula: null,
  styleId: 0,
});
const product: PriceListProductRow = {
  key: "TEST-1",
  keyKind: "product-code",
  sheetName: "Brand",
  rowNumber: 2,
  asin: "B000000001",
  cells: {
    code: cell("A2", 1, "TEST-1"),
    title: cell("B2", 2, "Sample"),
    standardPrice: cell("C2", 3, 10),
    minimumPrice: cell("D2", 4, 7),
  },
};
const workbook: PriceListWorkbook = {
  id: "price-list.test",
  fileName: "test.xlsx",
  importedAt: "2026-09-08T10:00:00Z",
  byteLength: 400,
  sha256: "a".repeat(64),
  sheets: [
    {
      name: "Brand",
      hidden: false,
      rowCount: 2,
      columnCount: 4,
      cells: Object.values(product.cells),
      merges: [],
      rowHeights: {},
      columnWidths: {},
      hiddenRows: [],
      hiddenColumns: [],
    },
  ],
  products: [product],
  styles: [
    {
      fontName: "Arial",
      fontSize: 11,
      bold: false,
      italic: false,
      color: "#000000",
      background: "#ffffff",
      horizontal: "left",
      vertical: "middle",
      wrap: false,
      numberFormat: "General",
      border: false,
    },
  ],
  imageCount: 0,
  formulaCount: 0,
  warnings: [],
};
const amazon: PriceListAmazonRow = {
  sheetName: "Brand",
  rowNumber: 2,
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
let renderer: ReactTestRenderer | null = null;
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = null;
  vi.unstubAllGlobals();
});

describe("price-list workflow", () => {
  it("opens with local import and preserves original view; comparison is a deliberate read", async () => {
    const fetch = vi.fn(
      async (path: string) =>
        new Response(
          JSON.stringify(
            path.endsWith("/import")
              ? workbook
              : {
                  workbookId: workbook.id,
                  state: "complete",
                  rows: [amazon],
                  completed: 1,
                  total: 1,
                  fetchedAt: amazon.fetchedAt,
                  message: "核對完成",
                },
          ),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetch);
    await act(async () => {
      renderer = create(<PriceListPanel onClose={() => undefined} />);
    });
    expect(fetch).not.toHaveBeenCalled();
    const fileInput = renderer!.root.findByProps({
      "aria-label": "選取原始價目表",
    });
    await act(async () => {
      fileInput.props.onChange({
        target: { files: [new File(["fake"], "test.xlsx")] },
        currentTarget: { value: "" },
      });
    });
    const originalTab = renderer!.root
      .findAllByType("button")
      .find((button) => button.children.includes("原表檢視"))!;
    expect(originalTab.props["aria-pressed"]).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    const checkbox = renderer!.root
      .findAllByType("input")
      .find(
        (input) =>
          input.props.type === "checkbox" &&
          input.parent?.children.some(
            (child) =>
              typeof child === "string" && child.includes("Amazon 首圖"),
          ),
      )!;
    expect(checkbox.props.checked).toBe(false);
    const read = renderer!.root
      .findAllByType("button")
      .find((button) => button.children.includes("讀取 Amazon 價格與首圖"))!;
    await act(async () => {
      read.props.onClick();
    });
    expect(fetch.mock.calls[1]?.[0]).toBe("/api/price-list/amazon-refresh");
    expect(originalTab.props["aria-pressed"]).toBe(true);
    const text = JSON.stringify(renderer!.toJSON());
    expect(text).toContain("Amazon 設定售價");
    expect(text).toContain("US$ 12.00");
    expect(text).toContain("US$ 8.00");
    expect(text).toContain("★ 有差異");
    expect(text).toContain("10");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("does not call import for files larger than the actual workbook limit", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await act(async () => {
      renderer = create(<PriceListPanel onClose={() => undefined} />);
    });
    await act(async () => {
      renderer!.root
        .findByProps({ "aria-label": "選取原始價目表" })
        .props.onChange({
          target: { files: [{ name: "large.xlsx", size: 26 * 1024 * 1024 }] },
          currentTarget: { value: "" },
        });
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(renderer!.toJSON())).toContain("25 MB");
  });
  it("keeps missing prices and a not-set minimum out of the same bucket", () => {
    expect(priceListAmazonDifference(product, undefined)).toBe("unknown");
    expect(
      priceListAmazonDifference(product, {
        ...amazon,
        standardPrice: 10,
        minimumPrice: 7,
      }),
    ).toBe("same");
    expect(
      priceListAmazonDifference(product, {
        ...amazon,
        standardPrice: 10,
        minimumPrice: null,
        minimumPriceStatus: "not-set",
      }),
    ).toBe("unknown");
    expect(
      priceListAmazonDifference(product, { ...amazon, status: "incomplete" }),
    ).toBe("unknown");
    expect(priceListAmazonDifference(product, amazon)).toBe("different");
  });
});
