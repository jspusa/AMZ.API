import { describe, expect, it } from "vitest";
import { inspectImageFolders, readDroppedImageFolders, type BrowserFolderEntry } from "../src/renderer/src/image-folder-import";

function selected(folder: string, name: string, content = "image") {
  return { relativePath: `${folder}/${name}`, file: new File([content], name, { type: "image/jpeg" }) };
}

describe("folder image import", () => {
  it("groups selected family folders by exact SKU and sorts the complete image set", () => {
    const result = inspectImageFolders([
      selected("family/AF_US組圖_AFA12AM_V11", "AFA12AM_02_賣點.jpg"),
      selected("family/AF_US組圖_AFA13AM_V11", "AFA13AM_01_主圖.jpg"),
      selected("family/AF_US組圖_AFA12AM_V11", "AFA12AM_01_主圖.jpg"),
    ]);
    expect(result.error).toBeNull();
    expect(result.rows.map(row => ({ sku: row.sellerSku, orders: row.images.map(image => image.slot), errors: row.errors }))).toEqual([
      { sku: "AFA12AM", orders: [0, 1], errors: [] },
      { sku: "AFA13AM", orders: [0], errors: [] },
    ]);
  });

  it("reads every browser directory page before accepting a folder", async () => {
    const fileEntry = (name: string): BrowserFolderEntry => ({ name, isFile: true, isDirectory: false, file: success => success(new File(["image"], name, { type: "image/jpeg" })) });
    const pages = [[fileEntry("AFA12AM_02.jpg")], [fileEntry("AFA12AM_01.jpg")], []];
    const folder: BrowserFolderEntry = { name: "AFA12AM", isDirectory: true, isFile: false, createReader: () => ({ readEntries: success => success(pages.shift()!) }) };
    const selectedFiles = await readDroppedImageFolders([folder]);
    expect(inspectImageFolders(selectedFiles).rows[0]).toMatchObject({ sellerSku: "AFA12AM", errors: [], fileCount: 2 });
  });

  it.each([
    ["duplicate versions", [selected("AFA12AM_V1", "AFA12AM_01.jpg"), selected("AFA12AM_V2", "AFA12AM_01.jpg")]],
    ["duplicate positions", [selected("AFA12AM", "AFA12AM_01.jpg"), selected("AFA12AM", "AFA12AM_01_副本.jpg")]],
    ["wrong SKU", [selected("AFA12AM", "AFA12AM_01.jpg"), selected("AFA12AM", "AFA13AM_02.jpg")]],
    ["zero-byte image", [selected("AFA12AM", "AFA12AM_01.jpg", "")]],
    ["missing numbered position", [selected("AFA12AM", "AFA12AM_01.jpg"), selected("AFA12AM", "AFA12AM_03.jpg")]],
    ["malformed image name", [selected("AFA12AM", "AFA12AM_01.jpg"), selected("AFA12AM", "notes.txt")]],
  ])("blocks every affected SKU for %s while preserving safe folders", (_name, invalid) => {
    const result = inspectImageFolders([...invalid, selected("VALID-SKU", "VALID-SKU_01.jpg")]);
    expect(result.rows.filter(row => !row.errors.length).map(row => row.sellerSku)).toEqual(["VALID-SKU"]);
    expect(result.rows.filter(row => row.folderName !== "VALID-SKU").every(row => row.errors.length > 0)).toBe(true);
  });

  it("accepts thirty full folders but rejects thirty-one without truncating the selection", () => {
    const maximum = Array.from({ length: 30 }, (_, sku) => Array.from({ length: 10 }, (_, image) => selected(`SKU-${sku}`, `SKU-${sku}_${String(image + 1).padStart(2, "0")}.jpg`))).flat();
    expect(inspectImageFolders(maximum).rows.filter(row => !row.errors.length)).toHaveLength(30);
    expect(inspectImageFolders([...maximum, selected("SKU-31", "SKU-31_01.jpg")])).toMatchObject({ rows: [], error: expect.stringContaining("30") });
  });

  it("rejects an unread directory page instead of accepting the files already encountered", async () => {
    let page = 0;
    const folder: BrowserFolderEntry = { name: "AFA12AM", isDirectory: true, isFile: false, createReader: () => ({ readEntries: (success, failure) => {
      if (page++ === 0) success([{ name: "AFA12AM_01.jpg", isFile: true, isDirectory: false, file: ok => ok(new File(["image"], "AFA12AM_01.jpg")) }]);
      else failure(new Error("unavailable"));
    } }) };
    await expect(readDroppedImageFolders([folder])).rejects.toThrow("未完整讀取");
  });
});
