import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  agedInventoryWorkbookDownloadUrl,
} from "../src/renderer/src/components/aged-inventory-panel";
import {
  contentAuditWorkbookDownloadUrl,
} from "../src/renderer/src/components/content-audit-panel";
import {
  imageAuditWorkbookDownloadUrl,
} from "../src/renderer/src/components/image-audit-panel";
import {
  downloadApiWorkbookResponse,
} from "../src/renderer/src/api-workbook-download";

const MARKETPLACE_ID = "ATVPDKIKX0DER";
const EXPORT_ID = "11111111-1111-4111-8111-111111111111";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("R08 renderer main-owned workbook downloads", () => {
  it("addresses every snapshot only by its opaque export capability", () => {
    const content = new URL(
      contentAuditWorkbookDownloadUrl(MARKETPLACE_ID, EXPORT_ID, "attention"),
      "https://pages.example.invalid",
    );
    expect(content.pathname).toBe("/api/sp-api/listing-content/export");
    expect(Object.fromEntries(content.searchParams)).toEqual({
      marketplaceId: MARKETPLACE_ID,
      exportId: EXPORT_ID,
      audit: "1",
      download: "1",
      scope: "attention",
    });

    const image = new URL(
      imageAuditWorkbookDownloadUrl(MARKETPLACE_ID, EXPORT_ID),
      "https://pages.example.invalid",
    );
    expect(image.pathname).toBe("/api/sp-api/listing-content/export");
    expect(Object.fromEntries(image.searchParams)).toEqual({
      marketplaceId: MARKETPLACE_ID,
      exportId: EXPORT_ID,
      imageAudit: "1",
      download: "1",
    });

    const aged = new URL(
      agedInventoryWorkbookDownloadUrl(MARKETPLACE_ID, EXPORT_ID),
      "https://pages.example.invalid",
    );
    expect(aged.pathname).toBe("/api/sp-api/aged-inventory");
    expect(Object.fromEntries(aged.searchParams)).toEqual({
      marketplaceId: MARKETPLACE_ID,
      exportId: EXPORT_ID,
      download: "1",
    });
    for (const url of [content, image, aged]) {
      expect(url.searchParams.has("reportId")).toBe(false);
      expect(url.searchParams.has("documentId")).toBe(false);
    }
  });

  it("saves the exact main response blob and honors its safe filename", async () => {
    const workbookBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xaa, 0x55]);
    const response = new Response(workbookBytes, {
      headers: {
        "content-type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition":
          "attachment; filename=content.xlsx; filename*=UTF-8''FBA-%E6%96%87%E6%A1%88%E5%81%A5%E6%AA%A2-US-2030-01-02.xlsx",
      },
    });
    const anchor = {
      href: "",
      download: "",
      click: vi.fn(),
      remove: vi.fn(),
    };
    const appendChild = vi.fn();
    vi.stubGlobal("document", {
      createElement: vi.fn(() => anchor),
      body: { appendChild },
    });
    vi.stubGlobal("window", {
      setTimeout: vi.fn((callback: () => void) => {
        callback();
        return 1;
      }),
    });
    const createObjectURL = vi.spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:main-owned-workbook");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);

    await downloadApiWorkbookResponse(response, "fallback.xlsx");

    expect(createObjectURL).toHaveBeenCalledOnce();
    const savedBlob = createObjectURL.mock.calls[0]?.[0];
    expect(savedBlob).toBeInstanceOf(Blob);
    expect(new Uint8Array(await (savedBlob as Blob).arrayBuffer()))
      .toEqual(workbookBytes);
    expect(anchor).toMatchObject({
      href: "blob:main-owned-workbook",
      download: "FBA-文案健檢-US-2030-01-02.xlsx",
    });
    expect(appendChild).toHaveBeenCalledWith(anchor);
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(anchor.remove).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:main-owned-workbook");
  });

  it("keeps renderer audit modules free of parallel workbook builders", async () => {
    const [contentSource, imageSource, panelSource] = await Promise.all([
      readFile(
        new URL("../src/renderer/src/content-audit-excel.ts", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../src/renderer/src/image-audit.ts", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL(
          "../src/renderer/src/components/content-audit-panel.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
    ]);
    expect(contentSource).not.toContain("createContentAuditWorkbookV2");
    expect(contentSource).not.toContain("downloadContentAuditWorkbook");
    expect(imageSource).not.toContain("createImageAuditWorkbook");
    expect(imageSource).not.toContain("downloadImageAuditWorkbook");
    expect(panelSource).not.toContain("addPagesDictionarySpellingIssues(");
    expect(panelSource).not.toContain('import("../content-spelling-rules")');
    expect(panelSource).toContain("content-spelling-metadata");
  });
});
