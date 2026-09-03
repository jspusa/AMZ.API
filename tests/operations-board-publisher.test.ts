import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  operationsBoardManagementItemId,
  parseOperationsBoardPublisherDraft,
} from "../src/main/operations-board-publisher";

describe("operations bulletin publisher", () => {
  it("normalizes an expiry draft without adding live Amazon data", () => {
    expect(parseOperationsBoardPublisherDraft({
      type: "expiry",
      marketplaceId: " ATVPDKIKX0DER ",
      sellerSku: " ASCL01 ",
      expiryDate: "2026-12-31",
      note: " 先出舊批次 ",
    })).toEqual({
      type: "expiry",
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "ASCL01",
      expiryDate: "2026-12-31",
      stopSaleDate: null,
      note: "先出舊批次",
    });
  });

  it("migrates a legacy one-day promotion draft into one exact v2 date range", () => {
    expect(parseOperationsBoardPublisherDraft({
      type: "promotion",
      date: "2026-10-13",
      title: " Prime Big Deal Days ",
      note: " 提前確認折扣與備貨 ",
      countdown: false,
    })).toEqual({
      type: "promotion",
      startDate: "2026-10-13",
      endDate: "2026-10-13",
      title: "Prime Big Deal Days",
      note: "提前確認折扣與備貨",
      countdown: false,
    });
  });

  it("normalizes v2 stop-sale and multi-day promotion drafts", () => {
    expect(parseOperationsBoardPublisherDraft({
      type: "expiry",
      marketplaceId: " ATVPDKIKX0DER ",
      sellerSku: " ASCL01 ",
      expiryDate: "2026-12-31",
      stopSaleDate: "2026-10-31",
      note: " 先停售 ",
    })).toEqual({
      type: "expiry",
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "ASCL01",
      expiryDate: "2026-12-31",
      stopSaleDate: "2026-10-31",
      note: "先停售",
    });
    expect(parseOperationsBoardPublisherDraft({
      type: "promotion",
      startDate: "2026-10-13",
      endDate: "2026-10-15",
      title: " Prime Big Deal Days ",
      note: " 三日檔期 ",
      countdown: true,
    })).toEqual({
      type: "promotion",
      startDate: "2026-10-13",
      endDate: "2026-10-15",
      title: "Prime Big Deal Days",
      note: "三日檔期",
      countdown: true,
    });
  });

  it("rejects malformed, unknown, or ambiguous drafts before opening the editor", () => {
    expect(() => parseOperationsBoardPublisherDraft({
      type: "expiry",
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "ASCL01",
      expiryDate: "2026-02-30",
      note: "",
    })).toThrow("日期不存在");
    expect(() => parseOperationsBoardPublisherDraft({
      type: "expiry",
      marketplaceId: "UNKNOWN",
      sellerSku: "ASCL01",
      expiryDate: "2026-12-31",
      note: "",
    })).toThrow("Amazon 站點無效");
    expect(() => parseOperationsBoardPublisherDraft({
      type: "expiry",
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "ASCL01",
      expiryDate: "2026-12-31",
      stopSaleDate: "2027-01-01",
      note: "",
    })).toThrow(/停售日.*效期/u);
    expect(() => parseOperationsBoardPublisherDraft({
      type: "promotion",
      startDate: "2026-10-15",
      endDate: "2026-10-13",
      title: "Prime Big Deal Days",
      note: "",
      countdown: true,
    })).toThrow(/結束日.*開始日/u);
    expect(() => parseOperationsBoardPublisherDraft({
      type: "promotion",
      date: "2026-10-13",
      title: "Prime Big Deal Days",
      note: "",
      countdown: false,
      hidden: "not allowed",
    })).toThrow("格式無效");
    expect(() => parseOperationsBoardPublisherDraft({
      type: "promotion",
      date: "2026-10-13",
      startDate: "2026-10-13",
      endDate: "2026-10-13",
      title: "Prime Big Deal Days",
      note: "",
      countdown: false,
    })).toThrow("格式無效");
  });

  it("accepts only an exact UUID when opening an existing item", () => {
    expect(operationsBoardManagementItemId(
      "8a9f0a88-e3e1-4fe9-9056-6b06fb990105",
    )).toBe("8a9f0a88-e3e1-4fe9-9056-6b06fb990105");
    expect(() => operationsBoardManagementItemId("123")).toThrow("項目 ID");
  });

  it("routes public create and manage actions into the local secure editor", async () => {
    const [preload, main, contracts] = await Promise.all([
      readFile(new URL("../src/preload/index.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/main/index.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/shared/contracts.ts", import.meta.url), "utf8"),
    ]);

    expect(preload).toContain('ipcRenderer.invoke("fba:operations-board-publish"');
    expect(preload).toContain('ipcRenderer.invoke("fba:operations-board-manage"');
    expect(preload).toContain("schemaVersion: 2 as const");
    expect(contracts).toContain("readonly schemaVersion: 2");
    expect(contracts).toMatch(/operationsBoard:\s*\{[\s\S]*publish\([\s\S]*manage\(/u);

    const publishStart = main.indexOf('ipcMain.handle("fba:operations-board-publish"');
    const manageStart = main.indexOf('ipcMain.handle("fba:operations-board-manage"');
    expect(publishStart).toBeGreaterThan(0);
    expect(manageStart).toBeGreaterThan(publishStart);
    const publishHandler = main.slice(publishStart, manageStart);
    const manageHandler = main.slice(manageStart, manageStart + 800);
    expect(publishHandler).toContain("assertTrustedFrame(event)");
    expect(publishHandler).toContain("parseOperationsBoardPublisherDraft(draft)");
    expect(publishHandler).toContain("openOperationsBoardEditor({ draft:");
    expect(manageHandler).toContain("assertTrustedFrame(event)");
    expect(manageHandler).toContain("operationsBoardManagementItemId(itemId)");
    expect(manageHandler).toContain("openOperationsBoardEditor({ focusItemId:");
    expect(publishHandler).not.toContain("shell.openExternal");
    expect(manageHandler).not.toContain("shell.openExternal");
  });
});
