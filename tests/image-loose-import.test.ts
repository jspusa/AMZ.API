import { describe, expect, it } from "vitest";
import { buildSharedImageRows, inspectLooseImages, parseManualImageSkus } from "../src/renderer/src/image-loose-import";

const file = (name: string) => new File(["image"], name, { type: "image/jpeg" });

describe("shared image selection", () => {
  it("maps the numbered shared image to its source SKU and keeps only the selected position for multiple exact SKUs", () => {
    const inspected = inspectLooseImages([file("AFA21AM_09_系列底圖_模板.jpg")]);
    expect(inspected.error).toBeNull();
    expect(inspected.images[0]).toMatchObject({ slot: 8, seedSku: "AFA21AM", targets: "AFA21AM", errors: [] });
    const rows = buildSharedImageRows([{ ...inspected.images[0], targets: "AFA21AM\nAFA22AM" }]);
    expect(rows.map(row => ({ sku: row.sellerSku, slots: row.images.map(image => image.slot), errors: row.errors }))).toEqual([
      { sku: "AFA21AM", slots: [8], errors: [] },
      { sku: "AFA22AM", slots: [8], errors: [] },
    ]);
  });

  it("keeps unconfigured files visible and blocks duplicate slots only on affected SKUs", () => {
    const { images } = inspectLooseImages([file("shared.jpg"), file("AFA21AM_09.jpg"), file("AFA22AM_09.jpg")]);
    expect(buildSharedImageRows(images).find(row => row.sellerSku === null)).toMatchObject({ fileCount: 1, errors: expect.arrayContaining([expect.stringContaining("位置"), expect.stringContaining("SKU")]) });
    const rows = buildSharedImageRows([
      { ...images[0], slot: 8, targets: "AFA21AM" },
      images[1], images[2],
    ]);
    expect(rows.find(row => row.sellerSku === "AFA21AM")?.errors).toContain("第 9 張有重複檔案，請調整位置或移除其中一張。");
    expect(rows.find(row => row.sellerSku === "AFA22AM")?.errors).toEqual([]);
  });

  it("requires an explicit choice for ambiguous names and invalid positions, and rejects unsafe metadata", () => {
    const { images } = inspectLooseImages([file("SKU_01_09_note.jpg"), file("09.jpg"), new File([], "AFA21AM_09.jpg"), file("../AFA21AM_09.jpg")]);
    expect(images[0]).toMatchObject({ slot: null, seedSku: null });
    expect(images[1]).toMatchObject({ slot: 8, seedSku: null });
    expect(images[2].errors.join(" ")).toContain("內容");
    expect(images[3].errors.join(" ")).toContain("檔名");
    expect(buildSharedImageRows([{ ...images[1], slot: 10, targets: "AFA21AM" }])[0].errors.join(" ")).toContain("位置");
  });

  it("never normalizes or silently drops malformed manual targets", () => {
    expect(parseManualImageSkus("SKU_a\r\nSKU A\n")).toEqual({ skus: ["SKU_a", "SKU A"], error: null });
    for (const targets of [" AFA21AM", "AFA21AM ", "AFA21AM\nAFA21AM", "AFA21AM\n\t", "AFA\u202e21AM"]) {
      expect(parseManualImageSkus(targets).error).toBeTruthy();
      expect(buildSharedImageRows([{ ...inspectLooseImages([file("AFA21AM_09.jpg")]).images[0], targets }]).every(row => row.errors.length)).toBe(true);
    }
  });

  it("blocks the whole over-limit selection without preparing a truncated thirty-SKU subset", () => {
    const image = inspectLooseImages([file("AFA21AM_09.jpg")]).images[0];
    const targets = Array.from({ length: 31 }, (_, index) => `SKU-${index}`).join("\n");
    const rows = buildSharedImageRows([{ ...image, targets }]);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(row => row.errors.length > 0)).toBe(true);
    expect(inspectLooseImages(Array.from({length: 301}, () => file("shared.jpg"))).error).toContain("300");
  });
});
