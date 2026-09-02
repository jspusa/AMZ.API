import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  operationsBoardAnnouncementUrl,
  operationsBoardPublisherUrl,
} from "../src/main/operations-board-publisher";
// @ts-expect-error The production builder is an executable ESM script.
import { buildOperationsBoardSnapshot } from "../scripts/build-github-operations-board.mjs";

describe("operations bulletin publisher", () => {
  it("opens a completely prefilled GitHub expiry issue without live Amazon data", () => {
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
      title: "[公布欄｜即期] ASCL01",
      labels: "operations-board,operations-board-expiry",
      body: [
        "### Amazon 站點",
        "Amazon 美國 — ATVPDKIKX0DER",
        "",
        "### Seller SKU",
        "ASCL01",
        "",
        "### 人工效期",
        "2026-12-31",
        "",
        "### 備註",
        "先出舊批次",
      ].join("\n"),
    });
    expect(url.toString()).not.toMatch(/inventory|price|credential|token|secret/iu);
  });

  it("publishes an expiry draft through GitHub standard body and label prefill", () => {
    const url = new URL(operationsBoardPublisherUrl({
      type: "expiry",
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "ASCL01",
      expiryDate: "2026-12-31",
      note: "先出舊批次",
    }));
    const body = url.searchParams.get("body");
    const labels = url.searchParams.get("labels")?.split(",") ?? [];

    expect(body).not.toBeNull();
    expect(labels).toEqual(["operations-board", "operations-board-expiry"]);

    const { snapshot, skipped } = buildOperationsBoardSnapshot([{
      number: 192,
      state: "open",
      author_association: "OWNER",
      labels: [...labels, "operations-board-approved"].map((name) => ({ name })),
      body,
    }], new Date("2026-09-02T06:30:00.000Z"));

    expect(skipped).toEqual([]);
    expect(snapshot.items).toEqual([{
      id: "00000000-0000-4000-8000-000000000192",
      type: "expiry",
      marketplaceId: "ATVPDKIKX0DER",
      sellerSku: "ASCL01",
      expiryDate: "2026-12-31",
      note: "先出舊批次",
    }]);
  });

  it("prefills a promotion issue including the optional countdown decision", () => {
    const url = new URL(operationsBoardPublisherUrl({
      type: "promotion",
      date: "2026-10-13",
      title: "Prime Big Deal Days",
      note: "提前確認折扣與備貨",
      countdown: false,
    }));

    expect(Object.fromEntries(url.searchParams)).toEqual({
      title: "[公布欄｜促銷] Prime Big Deal Days",
      labels: "operations-board,operations-board-promotion",
      body: [
        "### 檔期日期",
        "2026-10-13",
        "",
        "### 促銷名稱",
        "Prime Big Deal Days",
        "",
        "### 備註",
        "提前確認折扣與備貨",
        "",
        "### 首頁倒數",
        "只顯示在月曆",
      ].join("\n"),
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
