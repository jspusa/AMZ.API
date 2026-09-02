import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
// @ts-expect-error The production builder is an executable ESM script.
import * as operationsBoardBuilder from "../scripts/build-github-operations-board.mjs";

const {
  buildOperationsBoardSnapshot,
  fetchOperationsBoardIssues,
  OPERATIONS_BOARD_APPROVED_LABEL,
} = operationsBoardBuilder;

const labels = (type: "expiry" | "promotion") => [
  { name: "operations-board" },
  { name: `operations-board-${type}` },
  { name: OPERATIONS_BOARD_APPROVED_LABEL },
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
    expect(workflow).toMatch(/permissions:[\s\S]*?issues:\s*write/u);
    expect(workflow).toMatch(
      /if:\s*>[\s\S]*github\.event_name != 'issues'[\s\S]*OWNER[\s\S]*MEMBER[\s\S]*COLLABORATOR/u,
    );
    expect(workflow.match(
      /contains\(github\.event\.issue\.labels\.\*\.name, 'operations-board'\)/gu,
    )).toHaveLength(2);
    expect(workflow).toContain(
      "contains(github.event.issue.labels.*.name, 'operations-board-approved')",
    );
    expect(workflow).toContain("node scripts/build-github-operations-board.mjs");
    expect(workflow).toContain("operations-board-approved");
    expect(workflow).toMatch(
      /github\.event\.action == 'opened'[\s\S]*issues\.addLabels/u,
    );
    expect(workflow.indexOf("node scripts/build-github-operations-board.mjs"))
      .toBeLessThan(workflow.indexOf("npm run build"));
  });

  it("paginates past unaffiliated public Issues before building the authorized snapshot", async () => {
    const outsiderIssues = Array.from({ length: 100 }, (_, index) => ({
      number: 1_000 + index,
      state: "open",
      author_association: "NONE",
      labels: labels("expiry"),
      body: "### Seller SKU\nSHOULD-NOT-PUBLISH",
    }));
    const authorizedIssue = {
      number: 12,
      state: "open",
      author_association: "OWNER",
      labels: labels("expiry"),
      body: [
        "### Amazon 站點",
        "Amazon 美國 — ATVPDKIKX0DER",
        "",
        "### Seller SKU",
        "AUTHORIZED-SKU",
        "",
        "### 人工效期",
        "2026-12-31",
        "",
        "### 備註",
        "合法公告",
      ].join("\n"),
    };
    const requestedPages: number[] = [];
    const issues = await fetchOperationsBoardIssues(
      "jspusa/AMZ.API",
      "test-token",
      async (input: URL | RequestInfo) => {
        const url = new URL(String(input));
        expect(url.searchParams.get("labels")).toBe(
          `operations-board,${OPERATIONS_BOARD_APPROVED_LABEL}`,
        );
        const page = Number(url.searchParams.get("page"));
        requestedPages.push(page);
        return new Response(JSON.stringify(
          page === 1 ? outsiderIssues : [authorizedIssue],
        ), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    );

    expect(requestedPages).toEqual([1, 2]);
    expect(buildOperationsBoardSnapshot(issues).snapshot.items).toEqual([
      expect.objectContaining({ sellerSku: "AUTHORIZED-SKU" }),
    ]);
  });

  it("fails closed when the bounded Issue pagination limit is exhausted", async () => {
    const fullPage = Array.from({ length: 100 }, (_, index) => ({
      number: 2_000 + index,
      state: "open",
      author_association: "NONE",
      labels: labels("expiry"),
      body: "### Seller SKU\nSHOULD-NOT-PUBLISH",
    }));
    const requestedPages: number[] = [];

    await expect(fetchOperationsBoardIssues(
      "jspusa/AMZ.API",
      "test-token",
      async (input: URL | RequestInfo) => {
        requestedPages.push(Number(new URL(String(input)).searchParams.get("page")));
        return new Response(JSON.stringify(fullPage), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    )).rejects.toThrow("超過安全分頁上限");
    expect(requestedPages).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
  });

  it("publishes the newest 100 valid announcements instead of silently dropping the latest one", () => {
    const issues = Array.from({ length: 101 }, (_, index) => ({
      number: index + 1,
      state: "open",
      author_association: "OWNER",
      labels: labels("expiry"),
      body: [
        "### Amazon 站點",
        "Amazon 美國 — ATVPDKIKX0DER",
        "",
        "### Seller SKU",
        `SKU-${String(index + 1).padStart(3, "0")}`,
        "",
        "### 人工效期",
        "2026-12-31",
        "",
        "### 備註",
        "合法公告",
      ].join("\n"),
    }));

    const { snapshot } = buildOperationsBoardSnapshot(issues);
    expect(snapshot.items).toHaveLength(100);
    expect(snapshot.items.map((item: { sellerSku?: string }) => item.sellerSku)).toEqual(
      Array.from({ length: 100 }, (_, index) => `SKU-${String(index + 2).padStart(3, "0")}`),
    );
  });

  it("keeps the internal approval label out of public Issue Forms", async () => {
    const [expiryForm, promotionForm] = await Promise.all([
      readFile(new URL("../.github/ISSUE_TEMPLATE/operations-board-expiry.yml", import.meta.url), "utf8"),
      readFile(new URL("../.github/ISSUE_TEMPLATE/operations-board-promotion.yml", import.meta.url), "utf8"),
    ]);
    expect(expiryForm).not.toContain("operations-board-approved");
    expect(promotionForm).not.toContain("operations-board-approved");
  });
});
