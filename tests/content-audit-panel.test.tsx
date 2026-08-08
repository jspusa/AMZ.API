import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ContentAuditPanel, {
  parseContentAuditSnapshot,
} from "../src/renderer/src/components/content-audit-panel";

describe("global FBA content audit panel", () => {
  it("explains the one-click scope and starts from a read-only state", () => {
    const markup = renderToStaticMarkup(
      <ContentAuditPanel
        marketplaceId="ATVPDKIKX0DER"
        marketplaceShort="US"
        onOpenSku={vi.fn()}
      />,
    );

    expect(markup).toContain("全部 FBA SKU");
    expect(markup).toContain("疑似錯字");
    expect(markup).toContain("少於五個賣點");
    expect(markup).toContain("缺成分");
    expect(markup).toContain("Amazon 唯讀＋Mac 本機拼字檢查");
    expect(markup).toContain("掃描 US 全部 FBA 文案");
    expect(markup).toContain("FBM 不會加入");
    expect(markup).not.toContain("全站內容健檢");
  });

  it("discloses fail-closed reads, PTD uncertainty and the local dictionary cap", async () => {
    const source = await readFile(
      new URL(
        "../src/renderer/src/components/content-audit-panel.tsx",
        import.meta.url,
      ),
      "utf8",
    );

    expect(source).toContain("讀取失敗／未完成");
    expect(source).toContain("本列未計入缺賣點、缺成分或 Mac 拼字統計");
    expect(source).toContain("成分未驗證");
    expect(source).toContain("大型 catalog 超過上限後的後續單字未做 Mac 字典檢查");
    expect(source).toContain("LOCAL_SPELLCHECK_WORD_LIMIT");
  });

  it("restores a completed in-memory result and exposes the problem-only Excel", () => {
    const snapshot = parseContentAuditSnapshot({
      marketplaceId: "ATVPDKIKX0DER",
      fetchedAt: "2026-08-06T08:00:00.000Z",
      rows: [
        {
          sellerSku: "AFA12AM",
          asin: "B09S5VY2JS",
          productType: "PET_FOOD",
          title: "Turkey Tendons",
          bulletPoints: ["One"],
          ingredients: "Turkey",
          readStatus: "complete",
          readErrors: [],
          issues: [
            {
              kind: "MISSING_BULLETS",
              field: "bulletPoints",
              message: "目前只有 1 個非空白賣點，少於 5 個。",
            },
          ],
        },
      ],
      summary: { total: 1 },
    });
    const markup = renderToStaticMarkup(
      <ContentAuditPanel
        marketplaceId="ATVPDKIKX0DER"
        marketplaceShort="US"
        onOpenSku={vi.fn()}
        cachedResult={{
          snapshot,
          filter: "all",
          query: "",
          spellcheckNote: "本機檢查已完成。",
        }}
      />,
    );

    expect(markup).toContain("完成讀取");
    expect(markup).toContain("匯出全部 1 個待確認項目 Excel");
    expect(markup).toContain("重新掃描");
    expect(markup).not.toContain("掃描 US 全部 FBA 文案");
    expect(markup).toContain("content-audit-export-primary");
    expect(markup.indexOf("Amazon 唯讀＋Mac 本機拼字檢查")).toBeLessThan(
      markup.indexOf("content-audit-export-primary"),
    );
    expect(markup.indexOf("content-audit-export-primary")).toBeLessThan(
      markup.indexOf("content-audit-summary"),
    );
  });

  it("shows typo text in red and explains invisible characters in one located guide", () => {
    const snapshot = parseContentAuditSnapshot({
      marketplaceId: "ATVPDKIKX0DER",
      fetchedAt: "2026-08-06T08:00:00.000Z",
      rows: [
        {
          sellerSku: "AFA12AM",
          asin: "B09S5VY2JS",
          productType: "PET_FOOD",
          title: "Cocount Turkey Tendons",
          bulletPoints: [
            "One",
            "Two",
            "Three",
            "Natural & Gentle\u200b : clean nutrition",
            "Five",
          ],
          ingredients: "Turkey\u200b Tendon",
          readStatus: "complete",
          readErrors: [],
          issues: [
            {
              kind: "SUSPECTED_TYPO",
              field: "title",
              token: "Cocount",
              suggestion: "Coconut",
              message: "發現明確的常見拼字。",
            },
            {
              kind: "SUSPECTED_TYPO",
              field: "bulletPoints",
              token: "U+200B",
              suggestion: "移除不可見字元",
              message: "發現不可見字元 U+200B。",
            },
          ],
        },
      ],
      summary: { total: 1 },
    });
    const markup = renderToStaticMarkup(
      <ContentAuditPanel
        marketplaceId="ATVPDKIKX0DER"
        marketplaceShort="US"
        onOpenSku={vi.fn()}
        cachedResult={{
          snapshot,
          filter: "all",
          query: "",
          spellcheckNote: "本機檢查已完成。",
        }}
      />,
    );

    expect(markup).toContain("content-audit-typo-highlight");
    expect(markup).toContain("color:#b42318");
    expect(markup).toContain(">Cocount</mark>");
    expect(markup).toContain("不可見字元統一說明");
    expect(markup).toContain("U+200B 是「零寬空格」，不是 U+200");
    expect(markup).toContain("Natural &amp; Gentle⟦U+200B 零寬空格⟧ : clean nutrition");
    expect(markup).toContain("位於「Gentle」與「:」之間；應手動修改此段");
    expect(markup).toContain("content-audit-invisible-more");
    expect(markup).toContain("…另有 1 筆");
    expect(markup.indexOf("賣點 4 · U+200B")).toBeLessThan(
      markup.indexOf("content-audit-invisible-more"),
    );
    expect(markup.indexOf("content-audit-invisible-more")).toBeLessThan(
      markup.indexOf("成分 · U+200B"),
    );
    expect(markup.match(/發現不可見字元 U\+200B/g)).toBeNull();
  });

  it("keeps a return path from an audit result into SKU editing", async () => {
    const drawerSource = await readFile(
      new URL(
        "../src/renderer/src/components/sku-operations-drawer.tsx",
        import.meta.url,
      ),
      "utf8",
    );

    expect(drawerSource).toContain("setReturnToAudit(true)");
    expect(drawerSource).toContain("← 返回全站文案健檢結果");
    expect(drawerSource).toContain("auditCacheByMarketplace[marketplaceId]");
  });

  it("fails closed when a row lacks an explicit complete read marker", () => {
    const snapshot = parseContentAuditSnapshot({
      marketplaceId: "ATVPDKIKX0DER",
      fetchedAt: "2026-08-06T08:00:00.000Z",
      rows: [
        {
          sellerSku: "AFA12AM",
          asin: "B09S5VY2JS",
          productType: "PET_FOOD",
          title: "Report-only title",
          bulletPoints: [],
          ingredients: "",
          issues: [
            {
              kind: "MISSING_INGREDIENTS",
              field: "ingredients",
              message: "must not survive an unverified read",
            },
          ],
        },
      ],
      summary: { total: 1 },
    });

    expect(snapshot.rows[0]).toMatchObject({
      readStatus: "incomplete",
      issues: [],
      readErrors: [
        expect.objectContaining({ code: "LISTING_CONTENT_NOT_RETURNED" }),
      ],
    });
    expect(snapshot.summary).toMatchObject({
      total: 1,
      completed: 0,
      incomplete: 1,
      missingBullets: 0,
      missingIngredients: 0,
    });
  });

  it("rejects a completed snapshot from a different marketplace before display or cache", () => {
    expect(() =>
      parseContentAuditSnapshot(
        {
          marketplaceId: "A1VC38T7YXB528",
          fetchedAt: "2026-08-06T08:00:00.000Z",
          rows: [],
          summary: { total: 0 },
        },
        "ATVPDKIKX0DER",
      ),
    ).toThrow(/目前選擇的站點不一致；已停止顯示與快取/u);
  });

  it.each([
    {
      label: "a malformed row",
      rows: [null],
      summary: { total: 1 },
    },
    {
      label: "a row without a SKU",
      rows: [{ sellerSku: "", readStatus: "complete", issues: [] }],
      summary: { total: 1 },
    },
    {
      label: "a declared total that exceeds the returned rows",
      rows: [
        {
          sellerSku: "AFA12AM",
          readStatus: "complete",
          readErrors: [],
          issues: [],
        },
      ],
      summary: { total: 2 },
    },
  ])("stops the audit instead of hiding $label", ({ rows, summary }) => {
    expect(() =>
      parseContentAuditSnapshot({
        marketplaceId: "ATVPDKIKX0DER",
        fetchedAt: "2026-08-06T08:00:00.000Z",
        rows,
        summary,
      }),
    ).toThrow(/已停止顯示不完整結果/);
  });
});
