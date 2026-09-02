import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
// @ts-expect-error The production builder is an executable ESM script.
import { buildOperationsBoardSnapshot } from "../scripts/build-github-operations-board.mjs";

const labels = (type: "expiry" | "promotion") => [
  { name: "operations-board" },
  { name: `operations-board-${type}` },
];

describe("GitHub-backed operations board snapshot", () => {
  it("publishes authorized announcements and rejects unaffiliated public authors", () => {
    const { snapshot, skipped } = buildOperationsBoardSnapshot([
      {
        number: 12,
        state: "open",
        author_association: "OWNER",
        labels: labels("expiry"),
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
      },
      {
        number: 13,
        state: "open",
        author_association: "COLLABORATOR",
        labels: labels("promotion"),
        body: [
          "### 檔期日期",
          "2026-10-13",
          "",
          "### 促銷名稱",
          "Prime Big Deal Days",
          "",
          "### 備註",
          "確認折扣",
          "",
          "### 首頁倒數",
          "需要顯示倒數",
        ].join("\n"),
      },
      {
        number: 14,
        state: "open",
        author_association: "NONE",
        labels: labels("expiry"),
        body: "### Seller SKU\nSHOULD-NOT-PUBLISH",
      },
    ], new Date("2026-09-02T03:00:00.000Z"));

    expect(snapshot).toEqual({
      schemaVersion: 1,
      revision: 1_788_318_000_000,
      updatedAt: "2026-09-02T03:00:00.000Z",
      items: [
        {
          id: "00000000-0000-4000-8000-000000000012",
          type: "expiry",
          marketplaceId: "ATVPDKIKX0DER",
          sellerSku: "ASCL01",
          expiryDate: "2026-12-31",
          note: "先出舊批次",
        },
        {
          id: "00000000-0000-4000-8000-000000000013",
          type: "promotion",
          date: "2026-10-13",
          title: "Prime Big Deal Days",
          note: "確認折扣",
          countdown: true,
        },
      ],
    });
    expect(skipped).toEqual([{ number: 14, reason: "建立者不是專案擁有者或協作者。" }]);
  });

  it("rebuilds Pages when announcements are created, edited, reopened, or withdrawn", async () => {
    const workflow = await readFile(
      new URL("../.github/workflows/pages.yml", import.meta.url),
      "utf8",
    );

    expect(workflow).toMatch(/issues:\s*\n\s*types:\s*\[opened, edited, closed, reopened, labeled, unlabeled\]/u);
    expect(workflow).toMatch(/permissions:[\s\S]*?issues:\s*read/u);
    expect(workflow).toContain("node scripts/build-github-operations-board.mjs");
    expect(workflow.indexOf("node scripts/build-github-operations-board.mjs"))
      .toBeLessThan(workflow.indexOf("npm run build"));
  });
});
