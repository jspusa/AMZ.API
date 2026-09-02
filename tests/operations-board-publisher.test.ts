import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  operationsBoardAnnouncementUrl,
  operationsBoardPublisherUrl,
} from "../src/main/operations-board-publisher";

describe("operations bulletin publisher", () => {
  it("opens a completely prefilled GitHub expiry form without live Amazon data", () => {
    const url = new URL(operationsBoardPublisherUrl({
      type: "expiry",
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "ASCL01",
      expiryDate: "2026-12-31",
      note: "先出舊批次",
    }));

    expect(url.origin).toBe("https://github.com");
    expect(url.pathname).toBe("/jspusa/AMZ.API/issues/new");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      template: "operations-board-expiry.yml",
      title: "[公布欄｜即期] ASCL01",
      marketplace: "Amazon 美國 — ATVPDKIKX0DER",
      "seller-sku": "ASCL01",
      "expiry-date": "2026-12-31",
      note: "先出舊批次",
    });
    expect(url.toString()).not.toMatch(/inventory|price|credential|token|secret/iu);
  });

  it("prefills a promotion form including the optional countdown decision", () => {
    const url = new URL(operationsBoardPublisherUrl({
      type: "promotion",
      date: "2026-10-13",
      title: "Prime Big Deal Days",
      note: "提前確認折扣與備貨",
      countdown: false,
    }));

    expect(Object.fromEntries(url.searchParams)).toEqual({
      template: "operations-board-promotion.yml",
      title: "[公布欄｜促銷] Prime Big Deal Days",
      "promotion-date": "2026-10-13",
      "promotion-title": "Prime Big Deal Days",
      note: "提前確認折扣與備貨",
      countdown: "只顯示在月曆",
    });
  });

  it("opens the exact source announcement for modification or withdrawal", () => {
    expect(operationsBoardAnnouncementUrl(
      "00000000-0000-4000-8000-000000000123",
    )).toBe("https://github.com/jspusa/AMZ.API/issues/123");
    expect(() => operationsBoardAnnouncementUrl(
      "8a9f0a88-e3e1-4fe9-9056-6b06fb990105",
    )).toThrow("舊公告");
  });

  it("keeps publishing behind narrow trusted-renderer IPC", async () => {
    const [preload, main, contracts] = await Promise.all([
      readFile(new URL("../src/preload/index.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/main/index.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/shared/contracts.ts", import.meta.url), "utf8"),
    ]);

    expect(preload).toContain('ipcRenderer.invoke("fba:operations-board-publish"');
    expect(preload).toContain('ipcRenderer.invoke("fba:operations-board-manage"');
    expect(contracts).toMatch(/operationsBoard:\s*\{[\s\S]*publish\([\s\S]*manage\(/u);

    const publishStart = main.indexOf('ipcMain.handle("fba:operations-board-publish"');
    const manageStart = main.indexOf('ipcMain.handle("fba:operations-board-manage"');
    expect(publishStart).toBeGreaterThan(0);
    expect(manageStart).toBeGreaterThan(publishStart);
    expect(main.slice(publishStart, manageStart)).toContain("assertTrustedFrame(event)");
    expect(main.slice(manageStart, manageStart + 700)).toContain("assertTrustedFrame(event)");
  });
});
