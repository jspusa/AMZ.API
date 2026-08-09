import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ContentAuditPanel, {
  parseContentAuditSnapshot,
  quickEditAvailabilityForRow,
  quickEditFocusForRow,
  resolveContentAuditQuickEditFocus,
} from "../src/renderer/src/components/content-audit-panel";
import type { ContentAuditRow } from "../src/renderer/src/content-quality";
import { contentLookupErrorMessage } from "../src/renderer/src/components/sku-operations-drawer";

function quickEditRow(
  overrides: Partial<ContentAuditRow> = {},
): ContentAuditRow {
  return {
    sellerSku: "QUICK-FIX",
    asin: "B000000123",
    productType: "PET_FOOD",
    title: "Clean title",
    bulletPoints: [
      "Naturall nutrition",
      "Second point",
      "Third point",
      "Fourth point",
      "Fifth point",
    ],
    ingredients: "Turkey",
    readStatus: "complete",
    readErrors: [],
    issues: [
      {
        kind: "SUSPECTED_TYPO",
        field: "bulletPoints",
        token: "Naturall",
        suggestion: "Natural",
        message: "疑似錯字。",
      },
    ],
    ...overrides,
  };
}

function freshListing(
  content: {
    title?: string;
    bulletPoints?: readonly string[];
    ingredients?: string;
  } = {},
) {
  return {
    sellerSku: "QUICK-FIX",
    asin: "B000000123",
    productType: "PET_FOOD",
    content: {
      title: content.title ?? "Clean title",
      bulletPoints: content.bulletPoints ?? [
        "Naturall nutrition",
        "Second point",
        "Third point",
        "Fourth point",
        "Fifth point",
      ],
      ingredients: content.ingredients ?? "Turkey",
    },
  };
}

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
    expect(markup).toContain("立刻修改");
    expect(markup).toContain("本次錯誤原因");
    expect(markup).toContain("賣點不足（賣點）");
    expect(markup).toContain("完整編輯");
    expect(markup.indexOf("Amazon 唯讀＋Mac 本機拼字檢查")).toBeLessThan(
      markup.indexOf("content-audit-export-primary"),
    );
    expect(markup.indexOf("content-audit-export-primary")).toBeLessThan(
      markup.indexOf("content-audit-summary"),
    );
  });

  it("opens a focused edit containing only flagged fields and missing bullet slots", async () => {
    const snapshot = parseContentAuditSnapshot({
      marketplaceId: "ATVPDKIKX0DER",
      fetchedAt: "2026-08-06T08:00:00.000Z",
      rows: [{
        sellerSku: "QUICK-FIX",
        asin: "B000000123",
        productType: "PET_FOOD",
        title: "Clean title",
        bulletPoints: ["Naturall nutrition"],
        ingredients: "Turkey",
        readStatus: "complete",
        readErrors: [],
        issues: [
          {
            kind: "SUSPECTED_TYPO",
            field: "bulletPoints",
            token: "Naturall",
            suggestion: "Natural",
            message: "疑似錯字。",
          },
          {
            kind: "MISSING_BULLETS",
            field: "bulletPoints",
            message: "少於五個賣點。",
          },
        ],
      }],
      summary: { total: 1 },
    });
    const focus = quickEditFocusForRow(snapshot.rows[0]);
    expect(focus).toMatchObject({
      sellerSku: "QUICK-FIX",
      asin: "B000000123",
      productType: "PET_FOOD",
      fields: ["bulletPoints"],
      bulletIndices: [0, 1, 2, 3, 4],
    });
    expect(focus?.evidence).toEqual([
      expect.objectContaining({
        issueKind: "SUSPECTED_TYPO",
        field: "bulletPoints",
        token: "Naturall",
        originalValue: "Naturall nutrition",
        originalBulletIndex: 0,
        originalValueFingerprint: expect.stringMatching(/^v1:/u),
      }),
      expect.objectContaining({
        issueKind: "MISSING_BULLETS",
        field: "bulletPoints",
        token: null,
        originalBulletIndex: null,
        originalValueFingerprint: expect.stringMatching(/^v1:/u),
      }),
    ]);
    expect(focus && resolveContentAuditQuickEditFocus(focus, freshListing({
      bulletPoints: ["Naturall nutrition"],
    }))).toMatchObject({
      status: "focused",
      focus: { bulletIndices: [0, 1, 2, 3, 4] },
    });

    const drawerSource = await readFile(
      new URL(
        "../src/renderer/src/components/sku-operations-drawer.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    expect(drawerSource).toContain("只修改健檢指出的欄位");
    expect(drawerSource).toContain("其他 Amazon 原值仍會原樣帶入預檢");
    expect(drawerSource).toContain("確認並預檢這次修正");
    expect(drawerSource).toContain("健檢定位已失效，已顯示完整編輯");
    expect(drawerSource).toContain("本次錯誤原因：{activeQuickEditFocus.reason}");
    expect(drawerSource).toContain("立刻修改未開始：");
  });

  it("keeps an unavailable quick-edit action visible and explains why it is disabled", () => {
    const row = quickEditRow({
      issues: [{
        kind: "SUSPECTED_TYPO",
        field: "bulletPoints",
        message: "疑似錯字但缺少可核對字詞。",
      }],
    });
    const availability = quickEditAvailabilityForRow(row);
    expect(availability).toMatchObject({
      status: "unavailable",
      reason: expect.stringContaining("疑似錯字（賣點）"),
      unavailableReason: expect.stringContaining("無法安全定位"),
    });

    const snapshot = parseContentAuditSnapshot({
      marketplaceId: "ATVPDKIKX0DER",
      fetchedAt: "2026-08-06T08:00:00.000Z",
      rows: [row],
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
          spellcheckNote: null,
        }}
      />,
    );
    expect(markup).toMatch(/class="content-audit-fix-now"[^>]*disabled=""/u);
    expect(markup).toContain("本次錯誤原因");
    expect(markup).toContain("立刻修改不可用");
    expect(markup).toContain("無法安全定位待修內容");
  });

  it("labels a failed fresh lookup as a quick edit that never started", () => {
    expect(contentLookupErrorMessage("Amazon 暫時無法查詢。", true)).toBe(
      "立刻修改未開始：Amazon 暫時無法查詢。",
    );
    expect(contentLookupErrorMessage("Amazon 暫時無法查詢。", false)).toBe(
      "Amazon 暫時無法查詢。",
    );
  });

  it("relocates one exact flagged bullet after Amazon changes its position", () => {
    const focus = quickEditFocusForRow(quickEditRow());
    expect(focus).not.toBeNull();
    const resolution = resolveContentAuditQuickEditFocus(
      focus!,
      freshListing({
        bulletPoints: [
          "Second point",
          "Third point",
          "Naturall nutrition",
          "Fourth point",
          "Fifth point",
        ],
      }),
    );

    expect(resolution).toEqual({
      status: "focused",
      focus: {
        reason: "疑似錯字（賣點「Naturall」）：疑似錯字。",
        fields: ["bulletPoints"],
        bulletIndices: [2],
        relocationNote:
          "Amazon 賣點順序已變動；系統依健檢時的完整原文，重新定位到賣點 3。",
      },
    });
  });

  it("falls back to full editing when the flagged bullet drifted despite retaining the token", () => {
    const focus = quickEditFocusForRow(quickEditRow());
    const resolution = resolveContentAuditQuickEditFocus(
      focus!,
      freshListing({
        bulletPoints: [
          "Updated Naturall nutrition",
          "Second point",
          "Third point",
          "Fourth point",
          "Fifth point",
        ],
      }),
    );

    expect(resolution).toMatchObject({ status: "stale" });
    if (resolution.status === "stale") {
      expect(resolution.message).toContain("原文已不存在");
      expect(resolution.message).toContain("已切換為完整編輯");
      expect(resolution.message).toContain("尚未送出任何修改");
    }
  });

  it("falls back to full editing when another system already fixed the typo", () => {
    const focus = quickEditFocusForRow(quickEditRow());
    const resolution = resolveContentAuditQuickEditFocus(
      focus!,
      freshListing({
        bulletPoints: [
          "Natural nutrition",
          "Second point",
          "Third point",
          "Fourth point",
          "Fifth point",
        ],
      }),
    );

    expect(resolution).toMatchObject({ status: "stale" });
  });

  it("falls back to full editing when exact bullet evidence is ambiguous", () => {
    const focus = quickEditFocusForRow(quickEditRow());
    const resolution = resolveContentAuditQuickEditFocus(
      focus!,
      freshListing({
        bulletPoints: [
          "Naturall nutrition",
          "Second point",
          "Naturall nutrition",
          "Fourth point",
          "Fifth point",
        ],
      }),
    );

    expect(resolution).toMatchObject({ status: "stale" });
    if (resolution.status === "stale") {
      expect(resolution.message).toContain("多個相同候選");
    }
  });

  it("rechecks missing bullets and ingredients against the fresh listing", () => {
    const missingBullets = quickEditFocusForRow(quickEditRow({
      bulletPoints: ["One", "Two", "Three", "Four"],
      issues: [{
        kind: "MISSING_BULLETS",
        field: "bulletPoints",
        message: "少於五個賣點。",
      }],
    }));
    expect(resolveContentAuditQuickEditFocus(
      missingBullets!,
      freshListing({ bulletPoints: ["One", "Two", "Three"] }),
    )).toMatchObject({
      status: "focused",
      focus: { fields: ["bulletPoints"], bulletIndices: [3, 4] },
    });
    expect(resolveContentAuditQuickEditFocus(
      missingBullets!,
      freshListing({ bulletPoints: ["One", "Two", "Three", "Four", "Five"] }),
    )).toMatchObject({ status: "stale" });

    const missingIngredients = quickEditFocusForRow(quickEditRow({
      ingredients: "",
      issues: [{
        kind: "MISSING_INGREDIENTS",
        field: "ingredients",
        message: "缺成分。",
      }],
    }));
    expect(resolveContentAuditQuickEditFocus(
      missingIngredients!,
      freshListing({ ingredients: "" }),
    )).toMatchObject({
      status: "focused",
      focus: { fields: ["ingredients"], bulletIndices: [] },
    });
    expect(resolveContentAuditQuickEditFocus(
      missingIngredients!,
      freshListing({ ingredients: "Turkey" }),
    )).toMatchObject({ status: "stale" });
  });

  it("keeps ingredients-unverified focused only while its exact value is current", () => {
    const focus = quickEditFocusForRow(quickEditRow({
      ingredients: "Turkey Tendon",
      issues: [{
        kind: "INGREDIENTS_UNVERIFIED",
        field: "ingredients",
        message: "需人工確認 PTD。",
      }],
    }));
    expect(resolveContentAuditQuickEditFocus(
      focus!,
      freshListing({ ingredients: "Turkey Tendon" }),
    )).toMatchObject({ status: "focused" });
    expect(resolveContentAuditQuickEditFocus(
      focus!,
      freshListing({ ingredients: "Turkey" }),
    )).toMatchObject({ status: "stale" });
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
