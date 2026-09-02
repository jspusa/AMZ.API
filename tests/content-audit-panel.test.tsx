import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ContentAuditPanel, {
  ContentAuditWorkbookFilePicker,
  ContentWorkbookBatchAllSkippedFailureCard,
  ContentWorkbookBatchBlockedFailureCard,
  ContentWorkbookBatchFailureCard,
  ContentWorkbookBatchPreviewCard,
  ContentWorkbookBatchResultCard,
  contentWorkbookBatchCommitBody,
  consumeContentAuditWorkbookInput,
  assertContentAuditWorkbookDownloadEvidence,
  contentAuditWorkbookDownloadUrl,
  contentAuditWorkbookSelection,
  parseContentWorkbookBatchBlockedFailure,
  parseContentWorkbookBatchAllSkippedFailure,
  parseContentWorkbookBatchFailure,
  parseContentWorkbookBatchPreview,
  parseContentWorkbookBatchResult,
  parseContentAuditSnapshot,
  quickEditAvailabilityForRow,
  quickEditFocusForRow,
  resolveContentAuditQuickEditFocus,
} from "../src/renderer/src/components/content-audit-panel";
import type {
  ContentAuditRow,
  ContentAuditSnapshot,
} from "../src/renderer/src/content-quality";
import { contentLookupErrorMessage } from "../src/renderer/src/components/sku-operations-drawer";
import { parseStandaloneAuditJob } from "../src/renderer/src/standalone-audit";
import { readRendererStylesheet } from "./renderer-stylesheet";

function completedContentJob(snapshot: ContentAuditSnapshot) {
  snapshot.exportId ??= "11111111-1111-4111-8111-111111111111";
  return parseStandaloneAuditJob({
    jobId: "84ec9cda-e878-4e87-984e-65c8c5652cee",
    contextId: "94ec9cda-e878-4e87-984e-65c8c5652cef",
    kind: "content",
    marketplaceId: snapshot.marketplaceId,
    mode: "live",
    options: {},
    ready: true,
    status: "completed",
    progress: {
      stage: "complete",
      message: "完成",
      completedUnits: snapshot.rows.length,
      totalUnits: snapshot.rows.length,
    },
    snapshot,
  }, {
    kind: "content",
    marketplaceId: snapshot.marketplaceId,
    mode: "live",
  });
}

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
    itemHighlight?: string;
    bulletPoints?: readonly string[];
    productDescription?: string;
    ingredients?: string;
  } = {},
) {
  return {
    sellerSku: "QUICK-FIX",
    asin: "B000000123",
    productType: "PET_FOOD",
    content: {
      title: content.title ?? "Clean title",
      itemHighlight: content.itemHighlight ?? "Original highlight",
      bulletPoints: content.bulletPoints ?? [
        "Naturall nutrition",
        "Second point",
        "Third point",
        "Fourth point",
        "Fifth point",
      ],
      productDescription:
        content.productDescription ?? "Original product description",
      ingredients: content.ingredients ?? "Turkey",
    },
  };
}

function occurrenceCount(value: string, search: string): number {
  return value.split(search).length - 1;
}

describe("global FBA content audit panel", () => {
  it("shows a selected workbook filename once while keeping the file input accessible", async () => {
    const fileName = "FBA-文案健檢-US-2026-01-02.xlsx";
    const markup = renderToStaticMarkup(
      <ContentAuditWorkbookFilePicker
        fileName={fileName}
        disabled={false}
        onSelect={vi.fn()}
      />,
    );
    const stylesheet = await readRendererStylesheet();

    expect(occurrenceCount(markup, fileName)).toBe(1);
    expect(markup).toContain('type="file"');
    expect(markup).toContain('class="content-audit-file-input"');
    expect(markup).toContain('aria-label="選擇要回傳的 Excel 檔案"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain("拖放單一 .xlsx 到這裡");
    expect(stylesheet).toContain(".content-audit-file-input");
    expect(stylesheet).toContain("clip-path: inset(50%)");
    expect(stylesheet).toContain(
      ".content-audit-file-picker:has(.content-audit-file-input:focus-visible)",
    );
  });

  it("accepts one xlsx for click or drop and honestly rejects other selections", () => {
    const workbook = { name: "FBA-文案健檢-US.xlsx" } as File;
    const text = { name: "notes.txt" } as File;

    expect(contentAuditWorkbookSelection([workbook])).toEqual({
      status: "selected",
      file: workbook,
    });
    expect(contentAuditWorkbookSelection([workbook, workbook])).toMatchObject({
      status: "rejected",
      message: expect.stringContaining("一次只能選擇一份"),
    });
    expect(contentAuditWorkbookSelection([text])).toMatchObject({
      status: "rejected",
      message: expect.stringContaining("只接受"),
    });
    expect(contentAuditWorkbookSelection([])).toEqual({ status: "empty" });
  });

  it("clears the native picker value so the same edited workbook can be selected again", () => {
    const workbook = { name: "FBA-文案健檢-US.xlsx" } as File;
    const input = {
      files: { 0: workbook, length: 1 },
      value: "C:\\fakepath\\FBA-文案健檢-US.xlsx",
    };

    expect(consumeContentAuditWorkbookInput(input)).toEqual([workbook]);
    expect(input.value).toBe("");
  });

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
    expect(markup).toContain("產品名稱少於 60");
    expect(markup).toContain("產品亮點少於 110");
    expect(markup).toContain("產品要點少於 150 或超過 200");
    expect(markup).toContain("產品敘述少於 1,800");
    expect(markup).toContain("Amazon 唯讀＋AMZ.API 共用英文辭典");
    expect(markup).toContain("Mac／Windows Notebook Key Bridge 在本機套用");
    expect(markup).toContain("文案不會送到第三方");
    expect(markup).toContain('<details class="health-advanced-details audit-details-disclosure">');
    expect(markup).toContain("詳細說明");
    expect(markup).not.toContain('audit-details-disclosure" open=""');
    expect(markup).toContain("掃描 US 全部 FBA 文案");
    expect(markup).toContain("FBM 不會加入");
    expect(markup).not.toContain("全站內容健檢");
  });

  it("fails loudly instead of saving an attention-only workbook as the full template", () => {
    const legacyAttentionResponse = new Response(new Uint8Array([1]), {
      headers: { "x-exported-fba-sku-count": "1" },
    });
    expect(() => assertContentAuditWorkbookDownloadEvidence(
      legacyAttentionResponse,
      "all",
      2,
    )).toThrow("Notebook Key 尚未支援「全部商品文案」Excel");

    const wrongCountResponse = new Response(new Uint8Array([1]), {
      headers: {
        "x-content-audit-export-scope": "all",
        "x-exported-fba-sku-count": "1",
      },
    });
    expect(() => assertContentAuditWorkbookDownloadEvidence(
      wrongCountResponse,
      "all",
      2,
    )).toThrow("Notebook Key 尚未支援「全部商品文案」Excel");

    const fullResponse = new Response(new Uint8Array([1]), {
      headers: {
        "x-content-audit-export-scope": "all",
        "x-exported-fba-sku-count": "2",
      },
    });
    expect(() => assertContentAuditWorkbookDownloadEvidence(
      fullResponse,
      "all",
      2,
    )).not.toThrow();
    expect(() => assertContentAuditWorkbookDownloadEvidence(
      legacyAttentionResponse,
      "attention",
      1,
    )).not.toThrow();
  });

  it("discloses fail-closed reads, PTD uncertainty and the shared Pages dictionary", async () => {
    const source = await readFile(
      new URL(
        "../src/renderer/src/components/content-audit-panel.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    const dictionarySource = await readFile(
      new URL("../src/shared/content-spelling-rules.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("讀取失敗／未完成");
    expect(source).toContain("本列未計入字數、缺賣點、缺成分或共用拼字統計");
    expect(source).toContain("成分未驗證");
    expect(source).toContain("CONTENT_SPELLING_DICTIONARY_VERSION");
    expect(source).toContain("CONTENT_SPELLING_DICTIONARY_LANGUAGE");
    expect(source).toContain("AMZ.API 共用美式英文辭典");
    expect(source).toContain(
      "await import(\"../../../shared/content-spelling-metadata\")",
    );
    expect(source).not.toContain("addPagesDictionarySpellingIssues(");
    expect(source).toContain("可匯出快照仍是唯一結果來源");
    expect(source).not.toContain("window.fbaOS.spellcheck");
    expect(dictionarySource).toContain("en_US.aff?raw");
    expect(dictionarySource).toContain("en_US.dic?raw");
    expect(dictionarySource).not.toMatch(/\bfetch\s*\(/u);
    expect(dictionarySource).not.toContain("window.fbaOS.spellcheck");
  });

  it("restores a completed in-memory result and exposes the problem-only Excel", () => {
    const snapshot = parseContentAuditSnapshot({
      marketplaceId: "ATVPDKIKX0DER",
      exportId: "content-audit-export-001",
      fetchedAt: "2026-08-06T08:00:00.000Z",
      rows: [
        {
          sellerSku: "AFA12AM",
          asin: "B09S5VY2JS",
          productType: "PET_FOOD",
          title: "Trukey Tendons",
          bulletPoints: ["One"],
          ingredients: "Turkey",
          readStatus: "complete",
          readErrors: [],
          variationRole: "child",
          variationParentSku: "PARENT-001",
          variationFamilyKey: "PARENT-001",
          variationTheme: "SIZE_NAME",
          relationshipStatus: "complete",
          relationshipMessage: "Amazon relationships 已完成核對。",
          issues: [
            {
              kind: "MISSING_BULLETS",
              field: "bulletPoints",
              message: "目前只有 1 個非空白賣點，少於 5 個。",
            },
            {
              kind: "SUSPECTED_TYPO",
              field: "title",
              token: "Trukey",
              suggestion: "Turkey",
              source: "pages-dictionary",
              message: "標題疑似有錯字「Trukey」，可檢查是否為「Turkey」。",
            },
          ],
        },
        {
          sellerSku: "CLEAN-SKU",
          asin: "B000000002",
          productType: "PET_FOOD",
          title: "C".repeat(60),
          itemHighlight: "H".repeat(110),
          bulletPoints: Array.from({ length: 5 }, () => "B".repeat(150)),
          productDescription: "D".repeat(1_800),
          ingredients: "Turkey",
          readStatus: "complete",
          readErrors: [],
          variationRole: "standalone",
          variationParentSku: null,
          variationFamilyKey: "CLEAN-SKU",
          variationTheme: null,
          relationshipStatus: "complete",
          relationshipMessage: "Amazon relationships 已完成核對。",
          issues: [],
        },
      ],
      summary: { total: 2 },
    });
    const markup = renderToStaticMarkup(
      <ContentAuditPanel
        marketplaceId="ATVPDKIKX0DER"
        marketplaceShort="US"
        onOpenSku={vi.fn()}
        initialJob={completedContentJob(snapshot)}
        cachedResult={{
          snapshot,
          filter: "all",
          query: "",
          spellcheckNote: "本機檢查已完成。",
        }}
      />,
    );

    expect(markup).toContain("完成讀取");
    expect(markup).toContain("待確認清單 · 匯出 1 項 Excel");
    expect(markup).toContain("只含有問題或讀取未完成的商品");
    expect(markup).toContain("完整模板 · 匯出全部 2 個商品 Excel");
    expect(markup).toContain("包含正常商品，可直接當批次更新模板");
    expect(markup).toContain("兩份都只在這台電腦建立；任一份都可回傳更新");
    expect(markup).toContain('data-export-scope="attention"');
    expect(markup).toContain('data-export-scope="all"');
    expect(occurrenceCount(markup, "<strong>詳細說明</strong>")).toBe(1);
    expect(markup).toContain("重新掃描");
    expect(markup).not.toContain("掃描 US 全部 FBA 文案");
    expect(markup).toContain("content-audit-export-primary");
    expect(markup).toContain("立刻修改");
    expect(markup).not.toContain("本次錯誤原因");
    expect(markup).toContain('aria-label="待修原因"');
    expect(occurrenceCount(markup, "目前只有 1 個非空白賣點，少於 5 個。")).toBe(1);
    expect(occurrenceCount(
      markup,
      "標題疑似有錯字「Trukey」，可檢查是否為「Turkey」。",
    )).toBe(1);
    expect(markup).toContain('class="kind-missing_bullets"');
    expect(markup).toContain("完整編輯");
    expect(snapshot.exportId).toBe("content-audit-export-001");
    expect(snapshot.rows[0]).toMatchObject({
      variationRole: "child",
      variationParentSku: "PARENT-001",
      variationFamilyKey: "PARENT-001",
      relationshipStatus: "complete",
    });
    expect(markup).toContain("回傳任一份 Excel 批次更新");
    expect(markup).toContain("只保留 F007、F008");
    expect(markup).toContain("只讀取與預檢實際附上的工作表");
    expect(markup).toContain("不要只複製儲存格");
    expect(markup).toContain("淺綠或黃色");
    expect(markup).not.toContain("淺藍或黃色");
    expect(markup).toContain("先預覽 Excel 變更（不寫入）");
    expect(markup).toContain("Touch ID／Windows Hello");
    expect(markup).toContain("全部通過，或你明確核對符合條件的 INVALID SKU 後");
    expect(markup).not.toContain("預檢通過後才會要求一次 Touch ID／Windows Hello");
    expect(markup).toContain("單一 SKU 的問題會隔離列出，其餘安全 SKU 繼續");
    expect(markup).toContain("結果不明的 SKU 絕不自動重送");
    expect(markup.indexOf("Amazon 唯讀＋AMZ.API 共用英文辭典")).toBeLessThan(
      markup.indexOf("content-audit-export-primary"),
    );
    expect(markup.indexOf("content-audit-export-primary")).toBeLessThan(
      markup.indexOf("content-audit-summary"),
    );
    expect(contentAuditWorkbookDownloadUrl(
      "ATVPDKIKX0DER",
      "content-audit-export-001",
      "attention",
    )).toContain("scope=attention");
    expect(contentAuditWorkbookDownloadUrl(
      "ATVPDKIKX0DER",
      "content-audit-export-001",
      "all",
    )).toContain("scope=all");
  });

  it("shows the complete before/after workbook diff before batch approval", () => {
    const preview = parseContentWorkbookBatchPreview({
      previewId: "preview-content-001",
      marketplaceId: "ATVPDKIKX0DER",
      expiresAt: "2026-08-22T10:00:00.000Z",
      status: "READY",
      changes: [{
        sellerSku: "DIFF-SKU-001",
        changedFields: ["title", "bulletPoints", "productDescription"],
        previous: {
          title: "Amazon original title",
          itemHighlight: "Original highlight",
          bulletPoints: ["Original bullet one", "Original bullet two"],
          productDescription: "Original full description",
          ingredients: "Turkey",
        },
        requested: {
          title: "Excel requested title",
          itemHighlight: "Original highlight",
          bulletPoints: ["Requested bullet one", "Requested bullet two"],
          productDescription: "Requested full description",
          ingredients: "Turkey",
        },
        issues: [{
          code: "WARN-001",
          severity: "WARNING",
          message: "Amazon 提醒：請再次確認產品敘述。",
          attributeNames: ["product_description"],
        }],
        exactBulletReplacement: null,
        validationStatus: "VALID",
        overrideAllowed: false,
      }],
      validationOverride: { required: false, sellerSkus: [] },
      notice: "預檢完成，尚未寫入。",
    }, "ATVPDKIKX0DER");

    const locked = renderToStaticMarkup(
      <ContentWorkbookBatchPreviewCard
        preview={preview}
        busy={false}
        acknowledged={false}
        overrideAcknowledged={false}
        onAcknowledgedChange={vi.fn()}
        onOverrideAcknowledgedChange={vi.fn()}
        onCommit={vi.fn()}
      />,
    );
    expect(locked).toContain("Amazon 原值");
    expect(locked).toContain("Excel 更新值");
    expect(locked).toContain("Amazon original title");
    expect(locked).toContain("Excel requested title");
    expect(locked).toContain("Original bullet two");
    expect(locked).toContain("Requested full description");
    expect(locked).toContain("Amazon Validation Preview 提醒");
    expect(locked).toContain(
      "我已核對上述每個將寫入 SKU 的完整原值、更新值、Amazon 提醒與會被刪除的第 6 項後產品要點",
    );
    expect(locked).toContain(
      "大量批次時，Touch ID／Windows Hello 只顯示總 SKU 數、高風險數、刪除總數、INVALID 數與驗證碼",
    );
    expect(locked).toContain('class="price-primary-button" disabled=""');
    expect(locked).not.toContain("預檢未通過，仍要上傳更新");
    expect(preview.status).toBe("READY");
    expect(contentWorkbookBatchCommitBody(
      preview,
      "ATVPDKIKX0DER",
      "content-batch-key-ready-001",
    )).toEqual({
      marketplaceId: "ATVPDKIKX0DER",
      previewId: "preview-content-001",
      idempotencyKey: "content-batch-key-ready-001",
    });

    const unlocked = renderToStaticMarkup(
      <ContentWorkbookBatchPreviewCard
        preview={preview}
        busy={false}
        acknowledged
        overrideAcknowledged={false}
        onAcknowledgedChange={vi.fn()}
        onOverrideAcknowledgedChange={vi.fn()}
        onCommit={vi.fn()}
      />,
    );
    expect(unlocked).toContain('class="price-primary-button"');
    expect(unlocked).not.toContain('class="price-primary-button" disabled=""');

    expect(() => parseContentWorkbookBatchPreview({
      ...preview,
      changes: [{
        ...preview.changes[0],
        changedFields: ["title"],
      }],
    }, "ATVPDKIKX0DER")).toThrow("欄位清單與前後內容不一致");
  });

  it("shows every isolated workbook row with SKU, sheet, row, field, and reason while safe SKUs remain actionable", () => {
    const preview = parseContentWorkbookBatchPreview({
      previewId: "preview-content-skipped-row-001",
      marketplaceId: "ATVPDKIKX0DER",
      expiresAt: "2026-09-02T10:00:00.000Z",
      status: "READY",
      changes: [{
        sellerSku: "SAFE-SKU-001",
        changedFields: ["title"],
        previous: {
          title: "Safe original title",
          itemHighlight: "",
          bulletPoints: [],
          productDescription: "",
          ingredients: "",
        },
        requested: {
          title: "Safe requested title",
          itemHighlight: "",
          bulletPoints: [],
          productDescription: "",
          ingredients: "",
        },
        issues: [],
        exactBulletReplacement: null,
        validationStatus: "VALID",
        overrideAllowed: false,
      }],
      skippedRows: [{
        sellerSku: "BAD-SKU-001",
        sourceSheet: "F007",
        rowNumber: 8,
        stage: "WORKBOOK",
        code: "ASIN_INVALID+PRODUCT_TYPE_TOO_LONG",
        fields: ["ASIN", "Product Type"],
        message: "ASIN：格式無效。 Product Type：超過 200 字元。",
      }],
      validationFailures: [{
        sellerSku: "AMAZON-BAD-SKU",
        code: "VALIDATION_FAILED",
        message: "Amazon 拒絕這個產品名稱。",
        requestId: "REQ-AMAZON-BAD-SKU",
        changedFields: ["title"],
        previous: {
          title: "Rejected original title",
          itemHighlight: "",
          bulletPoints: [],
          productDescription: "",
          ingredients: "",
        },
        requested: {
          title: "Rejected requested title",
          itemHighlight: "",
          bulletPoints: [],
          productDescription: "",
          ingredients: "",
        },
        issues: [{
          code: "8541",
          severity: "ERROR",
          message: "產品名稱不符合 Amazon 規則。",
          attributeNames: ["item_name"],
        }],
        overrideAllowed: false,
      }],
      validationOverride: { required: false, sellerSkus: [] },
      notice: "1 個有問題的 SKU 已隔離；安全 SKU 可繼續。",
    }, "ATVPDKIKX0DER");

    const markup = renderToStaticMarkup(
      <ContentWorkbookBatchPreviewCard
        preview={preview}
        busy={false}
        acknowledged={false}
        overrideAcknowledged={false}
        onAcknowledgedChange={vi.fn()}
        onOverrideAcknowledgedChange={vi.fn()}
        onCommit={vi.fn()}
      />,
    );

    expect(markup).toContain("BAD-SKU-001");
    expect(markup).toContain("F007 · Excel 第 8 列");
    expect(markup).toContain("ASIN、Product Type");
    expect(markup).toContain("格式無效");
    expect(markup).toContain("SAFE-SKU-001");
    expect(markup).toContain("AMAZON-BAD-SKU");
    expect(markup).toContain("欄位：產品名稱");
    expect(markup).toContain("Amazon 預檢失敗 SKU 已隔離");
    expect(markup).toContain("其餘安全 SKU 可繼續");
    expect(markup).toContain("一次確認並更新 1 個 SKU");
  });

  it("shows every field when all malformed workbook rows are skipped at zero writes", () => {
    const failure = parseContentWorkbookBatchAllSkippedFailure({
      code: "CONTENT_BATCH_ALL_SKIPPED",
      message: "2 個有問題的 SKU 已全部隔離；Amazon 寫入數為 0。",
      writeCount: 0,
      skippedRows: [
        {
          sellerSku: "BAD-ASIN",
          sourceSheet: "F001",
          rowNumber: 2,
          stage: "WORKBOOK",
          code: "ASIN_INVALID",
          fields: ["ASIN"],
          message: "ASIN：格式無效。",
        },
        {
          sellerSku: "BAD-TYPE",
          sourceSheet: "F001",
          rowNumber: 3,
          stage: "WORKBOOK",
          code: "PRODUCT_TYPE_TOO_LONG",
          fields: ["Product Type"],
          message: "Product Type：超過 200 字元。",
        },
      ],
      blockedChanges: [],
    });

    const markup = renderToStaticMarkup(
      <ContentWorkbookBatchAllSkippedFailureCard failure={failure} />,
    );

    expect(markup).toContain("BAD-ASIN");
    expect(markup).toContain("BAD-TYPE");
    expect(markup).toContain("Excel 第 2 列");
    expect(markup).toContain("Excel 第 3 列");
    expect(markup).toContain("ASIN");
    expect(markup).toContain("Product Type");
    expect(markup).toContain("同一次上傳全部列出");
  });

  it("shows every hidden same-language bullet byte-exactly when an Excel update will remove it", async () => {
    const firstFive = [
      "A".repeat(2_001),
      "B".repeat(5_000),
      "Visible Amazon bullet 3",
      "Visible Amazon bullet 4",
      "Visible Amazon bullet 5",
    ];
    const hidden = [
      "Hidden  Amazon\tbullet\n6",
      ...Array.from(
        { length: 4 },
        (_, index) => `Hidden legacy Amazon bullet ${index + 7}`,
      ),
    ];
    const raw = {
      previewId: "preview-content-overflow-disclosure-001",
      marketplaceId: "ATVPDKIKX0DER",
      expiresAt: "2026-08-31T10:00:00.000Z",
      status: "READY",
      changes: [{
        sellerSku: "OVERFLOW-SKU-001",
        changedFields: ["title", "bulletPoints"],
        previous: {
          title: "Amazon original title",
          itemHighlight: "Original highlight",
          bulletPoints: firstFive,
          productDescription: "Original description",
          ingredients: "Turkey",
        },
        requested: {
          title: "Excel requested title",
          itemHighlight: "Original highlight",
          bulletPoints: firstFive,
          productDescription: "Original description",
          ingredients: "Turkey",
        },
        exactBulletReplacement: {
          languageTag: "en_US",
          currentExactLanguageBulletPoints: [...firstFive, ...hidden],
          requestedExactLanguageBulletPoints: firstFive,
          removedOverflowBulletPoints: hidden,
        },
        issues: [],
        validationStatus: "VALID",
        overrideAllowed: false,
      }],
      blockedChanges: [],
      validationOverride: { required: false, sellerSkus: [] },
      notice: "預檢完成，尚未寫入。",
    };
    const preview = parseContentWorkbookBatchPreview(
      raw,
      "ATVPDKIKX0DER",
    );
    const markup = renderToStaticMarkup(
      <ContentWorkbookBatchPreviewCard
        preview={preview}
        busy={false}
        acknowledged={false}
        overrideAcknowledged={false}
        onAcknowledgedChange={vi.fn()}
        onOverrideAcknowledgedChange={vi.fn()}
        onCommit={vi.fn()}
      />,
    );
    const stylesheet = await readRendererStylesheet();

    expect(markup).toContain("本次會刪除 Amazon 目前第 6 項後");
    expect(markup).toContain("第 6–10 項 en_US 產品要點");
    hidden.forEach((bullet) => expect(markup).toContain(bullet));
    expect(markup).toContain(
      'class="content-audit-exact-bullet-removals"',
    );
    expect(stylesheet).toMatch(
      /\.content-audit-exact-bullet-removals\s*\{[^}]*overflow-wrap:\s*anywhere;[^}]*white-space:\s*pre-wrap;/su,
    );
    expect(markup).toContain("Amazon 原值（第 1–5 項）");
    expect(markup).toContain("會被刪除的第 6 項後產品要點");
    expect(contentWorkbookBatchCommitBody(
      preview,
      "ATVPDKIKX0DER",
      "content-batch-overflow-ack-001",
    )).toEqual({
      marketplaceId: "ATVPDKIKX0DER",
      previewId: "preview-content-overflow-disclosure-001",
      idempotencyKey: "content-batch-overflow-ack-001",
      exactBulletReplacement: {
        acknowledged: true,
        sellerSkus: ["OVERFLOW-SKU-001"],
      },
    });

    expect(() => parseContentWorkbookBatchPreview({
      ...raw,
      changes: [{
        ...raw.changes[0],
        exactBulletReplacement: {
          ...raw.changes[0]!.exactBulletReplacement,
          removedOverflowBulletPoints: hidden.slice(1),
        },
      }],
    }, "ATVPDKIKX0DER")).toThrow("刪除明細與前後內容不一致");
    const legacyChange = { ...raw.changes[0] } as Record<string, unknown>;
    delete legacyChange.exactBulletReplacement;
    expect(() => parseContentWorkbookBatchPreview({
      ...raw,
      changes: [legacyChange],
    }, "ATVPDKIKX0DER")).toThrow(/Notebook Key.*更新/u);
    for (const unsafeControl of ["\u200b", "\u202e"]) {
      const unsafeHidden = [...hidden];
      unsafeHidden[0] = `Hidden${unsafeControl}Amazon bullet 6`;
      expect(() => parseContentWorkbookBatchPreview({
        ...raw,
        changes: [{
          ...raw.changes[0],
          exactBulletReplacement: {
            ...raw.changes[0]!.exactBulletReplacement,
            currentExactLanguageBulletPoints: [
              ...firstFive,
              ...unsafeHidden,
            ],
            removedOverflowBulletPoints: unsafeHidden,
          },
        }],
      }, "ATVPDKIKX0DER")).toThrow("產品要點刪除明細格式無效");
    }
    const overMaximum = "X".repeat(5_001);
    expect(() => parseContentWorkbookBatchPreview({
      ...raw,
      changes: [{
        ...raw.changes[0],
        previous: {
          ...raw.changes[0]!.previous,
          bulletPoints: [overMaximum, ...firstFive.slice(1)],
        },
        requested: {
          ...raw.changes[0]!.requested,
          bulletPoints: [overMaximum, ...firstFive.slice(1)],
        },
        exactBulletReplacement: {
          ...raw.changes[0]!.exactBulletReplacement,
          currentExactLanguageBulletPoints: [
            overMaximum,
            ...firstFive.slice(1),
            ...hidden,
          ],
          requestedExactLanguageBulletPoints: [
            overMaximum,
            ...firstFive.slice(1),
          ],
        },
      }],
    }, "ATVPDKIKX0DER")).toThrow("原值或更新值格式無效");
  });

  it("shows incomplete Excel edits as explicit non-writing rows while safe changes remain actionable", () => {
    const preview = parseContentWorkbookBatchPreview({
      previewId: "preview-content-partial-001",
      marketplaceId: "ATVPDKIKX0DER",
      expiresAt: "2026-08-31T10:00:00.000Z",
      status: "READY",
      changes: [{
        sellerSku: "SAFE-SKU-001",
        changedFields: ["title", "bulletPoints"],
        previous: {
          title: "Safe original title",
          itemHighlight: "Safe highlight",
          bulletPoints: ["Safe bullet"],
          productDescription: "Safe description",
          ingredients: "Turkey",
        },
        requested: {
          title: "Safe requested title",
          itemHighlight: "Safe highlight",
          bulletPoints: ["Safe bullet"],
          productDescription: "Safe description",
          ingredients: "Turkey",
        },
        issues: [],
        exactBulletReplacement: null,
        validationStatus: "VALID",
        overrideAllowed: false,
      }],
      blockedChanges: [{
        sellerSku: "OUT-OF-STOCK-SKU",
        code: "CONTENT_READ_INCOMPLETE",
        message: "此列未納入本次更新且不會寫入 Amazon。",
        changedFields: ["title"],
        previous: {
          title: "Incomplete scan title",
          itemHighlight: "",
          bulletPoints: [],
          productDescription: "",
          ingredients: "",
        },
        requested: {
          title: "Requested but skipped title",
          itemHighlight: "",
          bulletPoints: [],
          productDescription: "",
          ingredients: "",
        },
      }],
      validationOverride: { required: false, sellerSkus: [] },
      notice: "1 個 SKU 尚未寫入；另有 1 個 SKU 已略過。",
    }, "ATVPDKIKX0DER");

    const markup = renderToStaticMarkup(
      <ContentWorkbookBatchPreviewCard
        preview={preview}
        busy={false}
        acknowledged
        overrideAcknowledged={false}
        onAcknowledgedChange={vi.fn()}
        onOverrideAcknowledgedChange={vi.fn()}
        onCommit={vi.fn()}
      />,
    );

    expect(markup).toContain("已略過 1 個原掃描未完整的 SKU");
    expect(markup).toContain("OUT-OF-STOCK-SKU");
    expect(markup).toContain("健檢取得的原值");
    expect(markup).toContain("Excel 更新值（本次略過）");
    expect(markup).toContain("Requested but skipped title");
    expect(markup).toContain("一次確認並更新 1 個 SKU");
    expect(markup).toContain("其餘已納入預檢的 SKU 可依上方結果繼續核對");
    expect(contentWorkbookBatchCommitBody(
      preview,
      "ATVPDKIKX0DER",
      "content-batch-key-partial-001",
    )).toEqual({
      marketplaceId: "ATVPDKIKX0DER",
      previewId: "preview-content-partial-001",
      idempotencyKey: "content-batch-key-partial-001",
    });

    expect(() => parseContentWorkbookBatchPreview({
      ...preview,
      blockedChanges: [{
        ...preview.blockedChanges[0],
        sellerSku: "SAFE-SKU-001",
      }],
    }, "ATVPDKIKX0DER")).toThrow("更新與略過 SKU 清單重複");
    expect(() => parseContentWorkbookBatchPreview({
      ...preview,
      blockedChanges: [{
        ...preview.blockedChanges[0],
        changedFields: ["title", "bulletPoints"],
      }],
    }, "ATVPDKIKX0DER")).toThrow("略過欄位清單與前後內容不一致");
  });

  it("shows exact skipped diffs when every edited Excel row is incomplete", () => {
    const failure = parseContentWorkbookBatchBlockedFailure({
      code: "CONTENT_READ_INCOMPLETE",
      message: "1 個已編輯 SKU 的 Amazon 原文在健檢時未完整讀取。",
      writeCount: 0,
      blockedChanges: [{
        sellerSku: "ALL-BLOCKED-SKU",
        code: "CONTENT_READ_INCOMPLETE",
        message: "此列未納入本次更新且不會寫入 Amazon。",
        changedFields: ["title"],
        previous: {
          title: "Incomplete scan title",
          itemHighlight: "",
          bulletPoints: [],
          productDescription: "",
          ingredients: "",
        },
        requested: {
          title: "Requested but skipped title",
          itemHighlight: "",
          bulletPoints: [],
          productDescription: "",
          ingredients: "",
        },
      }],
    });

    const markup = renderToStaticMarkup(
      <ContentWorkbookBatchBlockedFailureCard failure={failure} />,
    );

    expect(markup).toContain("全部略過且沒有寫入 Amazon");
    expect(markup).toContain("ALL-BLOCKED-SKU");
    expect(markup).toContain("Incomplete scan title");
    expect(markup).toContain("Requested but skipped title");
    expect(markup).not.toContain("一次確認並更新");
  });

  it("keeps skipped SKU evidence in the terminal batch receipt", () => {
    const result = parseContentWorkbookBatchResult({
      previewId: "preview-terminal-skipped-001",
      marketplaceId: "ATVPDKIKX0DER",
      status: "COMPLETED",
      rows: [{ sellerSku: "SAFE-SKU-001", state: "verified", error: null }],
      blockedChanges: [{
        sellerSku: "TERMINAL-BLOCKED-SKU",
        code: "CONTENT_READ_INCOMPLETE",
        message: "此列未納入本次更新且不會寫入 Amazon。",
        changedFields: ["title"],
        previous: {
          title: "Terminal skipped original",
          itemHighlight: "",
          bulletPoints: [],
          productDescription: "",
          ingredients: "",
        },
        requested: {
          title: "Terminal skipped request",
          itemHighlight: "",
          bulletPoints: [],
          productDescription: "",
          ingredients: "",
        },
      }],
      notice: "已完成 1 個 SKU；另有 1 個 SKU 已略過且未寫入。",
    }, "ATVPDKIKX0DER");

    const markup = renderToStaticMarkup(
      <ContentWorkbookBatchResultCard result={result} />,
    );

    expect(markup).toContain("批次處理完成");
    expect(markup).toContain("SAFE-SKU-001");
    expect(markup).toContain("已由 Amazon 回讀驗證");
    expect(markup).toContain("TERMINAL-BLOCKED-SKU");
    expect(markup).toContain("原掃描未完整的 SKU 已略過且未寫入");
    expect(markup).toContain("Terminal skipped request");
  });

  it("shows an unknown SKU without hiding the later successful SKU", () => {
    const result = parseContentWorkbookBatchResult({
      previewId: "preview-continued-after-unknown-001",
      marketplaceId: "ATVPDKIKX0DER",
      status: "COMPLETED_WITH_ISSUES",
      rows: [
        { sellerSku: "KTB05AM", state: "unknown", error: {
          message: "Amazon 已接受寫入，但安全回查期限內尚未取得相符結果。",
        } },
        { sellerSku: "KTB05AM-1", state: "verified", error: null },
      ],
      blockedChanges: [],
      skippedRows: [],
      notice:
        "已完成處理 2 個 SKU：1 個成功、0 個遭拒、1 個結果不明；其餘安全 SKU 均已繼續。",
    }, "ATVPDKIKX0DER");

    const markup = renderToStaticMarkup(
      <ContentWorkbookBatchResultCard result={result} />,
    );

    expect(markup).toContain("批次已完成；有問題 SKU 已個別隔離");
    expect(markup).toContain("KTB05AM");
    expect(markup).toContain("結果不明");
    expect(markup).toContain("KTB05AM-1");
    expect(markup).toContain("已由 Amazon 回讀驗證");
    expect(markup).toContain("不會自動重送");
    expect(markup).not.toContain("尚未開始，沒有送出");
  });

  it("requires an exact separate acknowledgement for an INVALID Amazon preview", () => {
    const raw = {
      previewId: "preview-content-invalid-001",
      marketplaceId: "ATVPDKIKX0DER",
      expiresAt: "2026-08-22T10:00:00.000Z",
      status: "REQUIRES_VALIDATION_OVERRIDE",
      changes: [{
        sellerSku: "INVALID-SKU-001",
        changedFields: ["title"],
        previous: {
          title: "Amazon original title",
          itemHighlight: "Original highlight",
          bulletPoints: ["Original bullet"],
          productDescription: "Original description",
          ingredients: "Turkey",
        },
        requested: {
          title: "Excel requested title",
          itemHighlight: "Original highlight",
          bulletPoints: ["Original bullet"],
          productDescription: "Original description",
          ingredients: "Turkey",
        },
        issues: [{
          code: "8541",
          severity: "ERROR",
          message: "Amazon 拒絕這個產品名稱。",
          attributeNames: ["item_name"],
        }],
        exactBulletReplacement: null,
        validationStatus: "INVALID",
        overrideAllowed: true,
      }],
      validationOverride: {
        required: true,
        sellerSkus: ["INVALID-SKU-001"],
      },
      notice: "1 個 SKU 的 Amazon Validation Preview 明確未通過；目前仍為零寫入。",
    } as const;
    const preview = parseContentWorkbookBatchPreview(raw, "ATVPDKIKX0DER");

    expect(preview.status).toBe("REQUIRES_VALIDATION_OVERRIDE");
    expect(preview.changes[0]).toMatchObject({
      sellerSku: "INVALID-SKU-001",
      exactBulletReplacement: null,
      validationStatus: "INVALID",
      overrideAllowed: true,
      issues: [{
        code: "8541",
        severity: "ERROR",
        message: "Amazon 拒絕這個產品名稱。",
        attributeNames: ["item_name"],
      }],
    });
    expect(preview.validationOverride).toEqual({
      required: true,
      sellerSkus: ["INVALID-SKU-001"],
    });

    const locked = renderToStaticMarkup(
      <ContentWorkbookBatchPreviewCard
        preview={preview}
        busy={false}
        acknowledged
        overrideAcknowledged={false}
        onAcknowledgedChange={vi.fn()}
        onOverrideAcknowledgedChange={vi.fn()}
        onCommit={vi.fn()}
      />,
    );
    expect(locked).toContain("INVALID-SKU-001");
    expect(locked).toContain("Amazon original title");
    expect(locked).toContain("Excel requested title");
    expect(locked).toContain("Amazon Validation Preview：INVALID（未通過）");
    expect(locked).toContain("8541");
    expect(locked).toContain("Amazon 拒絕這個產品名稱");
    expect(locked).toContain("強制送出不代表預檢通過");
    expect(locked).toContain("預檢未通過，仍要上傳更新");
    expect(locked).toContain('<details open="">');
    expect(locked).toContain('class="price-primary-button" disabled=""');

    const unlocked = renderToStaticMarkup(
      <ContentWorkbookBatchPreviewCard
        preview={preview}
        busy={false}
        acknowledged
        overrideAcknowledged
        onAcknowledgedChange={vi.fn()}
        onOverrideAcknowledgedChange={vi.fn()}
        onCommit={vi.fn()}
      />,
    );
    expect(unlocked).not.toContain('class="price-primary-button" disabled=""');
    expect(contentWorkbookBatchCommitBody(
      preview,
      "ATVPDKIKX0DER",
      "content-batch-key-001",
    )).toEqual({
      marketplaceId: "ATVPDKIKX0DER",
      previewId: "preview-content-invalid-001",
      idempotencyKey: "content-batch-key-001",
      validationOverride: {
        acknowledged: true,
        sellerSkus: ["INVALID-SKU-001"],
      },
    });

    expect(() => parseContentWorkbookBatchPreview({
      ...raw,
      validationOverride: {
        required: true,
        sellerSkus: ["SOME-OTHER-SKU"],
      },
    }, "ATVPDKIKX0DER")).toThrow("強制送出 SKU 清單不一致");
    expect(() => parseContentWorkbookBatchPreview({
      ...raw,
      changes: [{
        ...raw.changes[0],
        overrideAllowed: false,
      }],
    }, "ATVPDKIKX0DER")).toThrow("強制送出狀態不一致");
  });

  it("shows the exact SKU, field diff, and reason when batch preflight fails", () => {
    const failure = parseContentWorkbookBatchFailure({
      code: "CONTENT_BATCH_VALIDATION_FAILED",
      message: "1 個 SKU 未通過預檢；整批仍為零寫入。",
      writeCount: 0,
      rows: [{
        sellerSku: "FAILED-SKU-001",
        code: "PREVIEW_CHANGED",
        message: "Amazon 商品內容預檢證據已改變，請重新預檢。",
        requestId: null,
        changedFields: ["title", "bulletPoints"],
        previous: {
          title: "Amazon original title",
          itemHighlight: "Original highlight",
          bulletPoints: ["Original bullet"],
          productDescription: "Original description",
          ingredients: "Turkey",
        },
        requested: {
          title: "Excel requested title",
          itemHighlight: "Original highlight",
          bulletPoints: ["Original bullet"],
          productDescription: "Original description",
          ingredients: "Turkey",
        },
        issues: [{
          code: "8541",
          severity: "ERROR",
          message: "Amazon 拒絕這個產品名稱。",
          attributeNames: ["item_name"],
        }],
        overrideAllowed: false,
      }],
    });

    const markup = renderToStaticMarkup(
      <ContentWorkbookBatchFailureCard failure={failure} />,
    );

    expect(markup).toContain("FAILED-SKU-001");
    expect(markup).toContain("產品名稱");
    expect(markup).toContain("Amazon original title");
    expect(markup).toContain("Excel requested title");
    expect(markup).toContain("PREVIEW_CHANGED");
    expect(markup).toContain("Amazon 商品內容預檢證據已改變");
    expect(markup).toContain("Amazon 拒絕這個產品名稱");
    expect(markup).toContain("欄位：產品名稱");
    expect(markup).toContain("此失敗不可強制略過");
    expect(markup).not.toContain("仍要上傳更新");
    expect(failure.blockedChanges).toEqual([]);
  });

  it("shows both hard preflight failures and skipped incomplete rows", () => {
    const failure = parseContentWorkbookBatchFailure({
      code: "CONTENT_BATCH_VALIDATION_FAILED",
      message: "1 個 SKU 未通過預檢；整批仍為零寫入。",
      writeCount: 0,
      rows: [{
        sellerSku: "FAILED-SKU-001",
        code: "PREVIEW_CHANGED",
        message: "Amazon 商品內容預檢證據已改變。",
        requestId: null,
        changedFields: ["title"],
        previous: {
          title: "Failed original title",
          itemHighlight: "Original highlight",
          bulletPoints: ["Original bullet"],
          productDescription: "Original description",
          ingredients: "Turkey",
        },
        requested: {
          title: "Failed requested title",
          itemHighlight: "Original highlight",
          bulletPoints: ["Original bullet"],
          productDescription: "Original description",
          ingredients: "Turkey",
        },
        issues: [],
        overrideAllowed: false,
      }],
      blockedChanges: [{
        sellerSku: "BLOCKED-SKU-001",
        code: "CONTENT_READ_INCOMPLETE",
        message: "此列未納入本次更新且不會寫入 Amazon。",
        changedFields: ["title"],
        previous: {
          title: "Incomplete original title",
          itemHighlight: "",
          bulletPoints: [],
          productDescription: "",
          ingredients: "",
        },
        requested: {
          title: "Skipped requested title",
          itemHighlight: "",
          bulletPoints: [],
          productDescription: "",
          ingredients: "",
        },
      }],
    });

    const markup = renderToStaticMarkup(
      <ContentWorkbookBatchFailureCard failure={failure} />,
    );

    expect(markup).toContain("FAILED-SKU-001");
    expect(markup).toContain("BLOCKED-SKU-001");
    expect(markup).toContain("另有 1 個原掃描未完整的 SKU 已略過");
    expect(markup).toContain("Incomplete original title");
    expect(markup).toContain("Skipped requested title");

    expect(() => parseContentWorkbookBatchFailure({
      ...failure,
      blockedChanges: [{
        ...failure.blockedChanges[0],
        sellerSku: "FAILED-SKU-001",
      }],
    })).toThrow("失敗與略過 SKU 清單重複");

    expect(() => parseContentWorkbookBatchFailure({
      ...failure,
      blockedChanges: Array.from({ length: 500 }, (_, index) => ({
        ...failure.blockedChanges[0],
        sellerSku: `BLOCKED-LIMIT-${index + 1}`,
      })),
    })).toThrow("SKU 清單超過安全上限");
  });

  it("uses a whole-card yellow cue only when a visible missing-bullets issue exists", async () => {
    const stylesheet = await readRendererStylesheet();

    expect(stylesheet).toContain(
      ".content-audit-list > article:has(.content-audit-issues .kind-missing_bullets)",
    );
    expect(stylesheet).not.toContain(
      ".content-audit-list > article:has(.content-audit-issues .kind-suspected_typo)",
    );
    expect(stylesheet).not.toContain(
      ".content-audit-list > article:has(.content-audit-issues .kind-read_incomplete)",
    );
    expect(stylesheet).toContain(
      ".content-audit-edit-actions > .content-audit-fix-now:disabled",
    );
    expect(stylesheet).toContain("cursor: not-allowed");
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
    expect(drawerSource).toContain("個待修欄位；其他 Amazon 原值仍會原樣帶入預檢");
    expect(drawerSource).not.toContain("查看本次待修原因");
    expect(drawerSource).not.toContain("{activeQuickEditFocus.reason}");
    expect(drawerSource).toContain("content-audit-field-reason");
    expect(drawerSource).toContain("quickEditReasonsForField");
    expect(drawerSource).toContain("立刻修改未開始：");
  });

  it("keeps single-ingredient mismatch reasons field-scoped and fresh-read fail closed", () => {
    const ingredients = "Turkey Tendon, Chicken, Coconut Glycerin";
    const row = quickEditRow({
      title: "Single-Ingredient dog treats",
      ingredients,
      issues: [{
        kind: "SINGLE_INGREDIENT_MISMATCH",
        field: "title",
        token: "Single-Ingredient",
        message:
          "產品名稱宣稱「Single-Ingredient」，但 Amazon ingredients 明確列出 3 項。",
      }],
    });
    const parsed = parseContentAuditSnapshot({
      marketplaceId: "ATVPDKIKX0DER",
      fetchedAt: "2026-08-06T08:00:00.000Z",
      rows: [row],
      summary: { total: 1 },
    });

    expect(parsed.summary.singleIngredientMismatch).toBe(1);
    const focus = quickEditFocusForRow(parsed.rows[0]!);
    expect(focus).toMatchObject({
      fields: ["title"],
      evidence: [expect.objectContaining({
        issueKind: "SINGLE_INGREDIENT_MISMATCH",
        reason: expect.stringContaining("Amazon ingredients"),
        relatedIngredients: ingredients,
        relatedIngredientsFingerprint: expect.stringMatching(/^v1:/u),
      })],
    });
    expect(focus && resolveContentAuditQuickEditFocus(focus, freshListing({
      title: row.title,
      ingredients,
    }))).toMatchObject({
      status: "focused",
      focus: {
        fields: ["title"],
        reasons: [expect.objectContaining({
          field: "title",
          bulletIndex: null,
          message: expect.stringContaining("Amazon ingredients"),
        })],
      },
    });
    expect(focus && resolveContentAuditQuickEditFocus(focus, freshListing({
      title: row.title,
      ingredients: "Turkey Tendon, Chicken",
    }))).toMatchObject({ status: "stale" });
    expect(focus && resolveContentAuditQuickEditFocus(focus, freshListing({
      title: "Dog treats",
      ingredients,
    }))).toMatchObject({ status: "stale" });
  });

  it("derives the deterministic single-ingredient mismatch when an older bridge omits it", () => {
    const snapshot = parseContentAuditSnapshot({
      marketplaceId: "ATVPDKIKX0DER",
      fetchedAt: "2026-08-06T08:00:00.000Z",
      rows: [{
        sellerSku: "OLD-BRIDGE-CLAIM",
        asin: "B000000321",
        productType: "PET_FOOD",
        title: "Single ingredient — Single-Ingredients turkey tendon treats",
        itemHighlight: "",
        bulletPoints: [],
        productDescription: "",
        ingredients: "Turkey Tendon\u2028Chicken",
        readStatus: "complete",
        readErrors: [],
        issues: [],
      }],
      summary: { total: 1 },
    });

    expect(snapshot.rows[0]?.issues).toEqual([
      expect.objectContaining({
        kind: "SINGLE_INGREDIENT_MISMATCH",
        field: "title",
        token: "Single ingredient",
        message: expect.stringContaining("明確列出 2 項"),
      }),
    ]);
    expect(snapshot.summary.singleIngredientMismatch).toBe(1);
  });

  it("derives and safely focuses the broader ingredient claim mismatches", () => {
    const snapshot = parseContentAuditSnapshot({
      marketplaceId: "ATVPDKIKX0DER",
      fetchedAt: "2026-08-06T08:00:00.000Z",
      rows: [{
        sellerSku: "QUICK-FIX",
        asin: "B000000123",
        productType: "PET_FOOD",
        title: "Turkey Tendons hypoallergenic treats",
        itemHighlight: "",
        bulletPoints: [],
        productDescription: "",
        ingredients: "Turkey, Chicken, Vegetable Glycerin",
        readStatus: "complete",
        readErrors: [],
        issues: [],
      }],
      summary: { total: 1 },
    });

    expect(snapshot.rows[0]?.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ token: "Tendons" }),
      expect.objectContaining({ token: "hypoallergenic" }),
    ]));
    const focus = quickEditFocusForRow(snapshot.rows[0]!);
    expect(focus).toMatchObject({
      fields: ["title"],
      evidence: [
        expect.objectContaining({ relatedIngredients: "Turkey, Chicken, Vegetable Glycerin" }),
        expect.objectContaining({ relatedIngredients: "Turkey, Chicken, Vegetable Glycerin" }),
      ],
    });
    expect(resolveContentAuditQuickEditFocus(
      focus!,
      freshListing({
        title: "Turkey Tendons hypoallergenic treats",
        ingredients: "Turkey, Chicken, Vegetable Glycerin",
      }),
    )).toMatchObject({ status: "focused" });
    expect(resolveContentAuditQuickEditFocus(
      focus!,
      freshListing({
        title: "Turkey Tendon treats",
        ingredients: "Turkey Tendon, Chicken, Vegetable Glycerin",
      }),
    )).toMatchObject({ status: "stale" });
  });

  it("merges issue filters into clickable summary numbers", () => {
    const snapshot = parseContentAuditSnapshot({
      marketplaceId: "ATVPDKIKX0DER",
      fetchedAt: "2026-08-06T08:00:00.000Z",
      rows: [quickEditRow({
        title: "Short title",
        issues: [{
          kind: "TITLE_BELOW_TARGET",
          field: "title",
          message: "產品名稱目前 11 個字元，低於 60 個字元。",
          actualLength: 11,
          minLength: 60,
        }],
      })],
      summary: { total: 1 },
    });
    const markup = renderToStaticMarkup(
      <ContentAuditPanel
        marketplaceId="ATVPDKIKX0DER"
        marketplaceShort="US"
        onOpenSku={vi.fn()}
        initialJob={completedContentJob(snapshot)}
        cachedResult={{
          snapshot,
          filter: "TITLE_BELOW_TARGET",
          query: "",
          spellcheckNote: null,
        }}
      />,
    );

    expect(markup).toContain('class="content-audit-summary" role="group" aria-label="文案健檢摘要與問題篩選"');
    expect(markup).toContain('data-audit-filter="TITLE_BELOW_TARGET"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('data-audit-filter="SINGLE_INGREDIENT_MISMATCH"');
    expect(markup).toContain("成分宣稱不一致");
    expect(markup).not.toContain('role="tablist"');
    expect(markup).not.toContain("單一成分宣稱不一致");
  });

  it("counts every row shown by the all-problems summary filter", () => {
    const snapshot = parseContentAuditSnapshot({
      marketplaceId: "ATVPDKIKX0DER",
      fetchedAt: "2026-08-06T08:00:00.000Z",
      rows: [
        quickEditRow({
          sellerSku: "HAS-ISSUE",
          title: "Short title",
          issues: [{
            kind: "TITLE_BELOW_TARGET",
            field: "title",
            message: "產品名稱目前 11 個字元，低於 60 個字元。",
            actualLength: 11,
            minLength: 60,
          }],
        }),
        quickEditRow({
          sellerSku: "READ-INCOMPLETE",
          asin: "B000000099",
          readStatus: "incomplete",
          readErrors: [{
            code: "LISTING_QUERY_FAILED",
            message: "Listings Items API 尚未完整回傳。",
          }],
          issues: [],
        }),
      ],
      summary: { total: 2 },
    });
    const markup = renderToStaticMarkup(
      <ContentAuditPanel
        marketplaceId="ATVPDKIKX0DER"
        marketplaceShort="US"
        onOpenSku={vi.fn()}
        initialJob={completedContentJob(snapshot)}
        cachedResult={{
          snapshot,
          filter: "all",
          query: "",
          spellcheckNote: null,
        }}
      />,
    );

    expect(markup).toMatch(
      /data-audit-filter="all"[^>]*>[\s\S]*?<span>有待確認<\/span><strong>2<\/strong>/u,
    );
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
        initialJob={completedContentJob(snapshot)}
        cachedResult={{
          snapshot,
          filter: "all",
          query: "",
          spellcheckNote: null,
        }}
      />,
    );
    expect(markup).toMatch(/class="content-audit-fix-now"[^>]*disabled=""/u);
    expect(markup).not.toContain("本次錯誤原因");
    expect(markup).toContain("立刻修改目前不可用");
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
        reasons: [{
          field: "bulletPoints",
          bulletIndex: 2,
          message: "疑似錯字。",
        }],
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

  it("safely focuses a short title only while the exact Amazon text is current", () => {
    const title = "T".repeat(59);
    const focus = quickEditFocusForRow(quickEditRow({
      title,
      issues: [{
        kind: "TITLE_BELOW_TARGET",
        field: "title",
        message: "產品名稱目前 59 個字元，低於 60 個字元。",
        actualLength: 59,
        minLength: 60,
      }],
    }));

    expect(focus).toMatchObject({
      fields: ["title"],
      bulletIndices: [],
      evidence: [expect.objectContaining({
        issueKind: "TITLE_BELOW_TARGET",
        actualLength: 59,
        minLength: 60,
        maxLength: null,
      })],
    });
    expect(resolveContentAuditQuickEditFocus(
      focus!,
      freshListing({ title }),
    )).toMatchObject({
      status: "focused",
      focus: { fields: ["title"], bulletIndices: [] },
    });
    expect(resolveContentAuditQuickEditFocus(
      focus!,
      freshListing({ title: "T".repeat(60) }),
    )).toMatchObject({ status: "stale" });
  });

  it("relocates one exact length-flagged bullet and rejects duplicate candidates", () => {
    const shortBullet = "B".repeat(149);
    const focus = quickEditFocusForRow(quickEditRow({
      bulletPoints: [shortBullet, "Second", "Third", "Fourth", "Fifth"],
      issues: [{
        kind: "BULLET_BELOW_TARGET",
        field: "bulletPoints",
        message: "產品要點 1 目前 149 個字元，低於 150 個字元。",
        bulletIndex: 0,
        actualLength: 149,
        minLength: 150,
        maxLength: 200,
      }],
    }));

    expect(focus).toMatchObject({
      fields: ["bulletPoints"],
      bulletIndices: [0],
    });
    expect(resolveContentAuditQuickEditFocus(
      focus!,
      freshListing({
        bulletPoints: ["Second", "Third", shortBullet, "Fourth", "Fifth"],
      }),
    )).toMatchObject({
      status: "focused",
      focus: {
        fields: ["bulletPoints"],
        bulletIndices: [2],
        relocationNote: expect.stringContaining("賣點 3"),
      },
    });
    expect(resolveContentAuditQuickEditFocus(
      focus!,
      freshListing({
        bulletPoints: [shortBullet, "Second", shortBullet, "Fourth", "Fifth"],
      }),
    )).toMatchObject({ status: "stale" });
  });

  it("focuses an overlong bullet only while it remains above 200 code points", () => {
    const longBullet = "😀".repeat(201);
    const focus = quickEditFocusForRow(quickEditRow({
      bulletPoints: [longBullet, "Second", "Third", "Fourth", "Fifth"],
      issues: [{
        kind: "BULLET_ABOVE_TARGET",
        field: "bulletPoints",
        message: "產品要點 1 目前 201 個字元，超過 200 個字元。",
        bulletIndex: 0,
        actualLength: 201,
        minLength: 150,
        maxLength: 200,
      }],
    }));

    expect(resolveContentAuditQuickEditFocus(
      focus!,
      freshListing({ bulletPoints: [longBullet] }),
    )).toMatchObject({
      status: "focused",
      focus: { fields: ["bulletPoints"], bulletIndices: [0] },
    });
    expect(resolveContentAuditQuickEditFocus(
      focus!,
      freshListing({ bulletPoints: ["😀".repeat(200)] }),
    )).toMatchObject({ status: "stale" });
  });

  it("opens highlight and description length issues only after exact fresh-read evidence matches", () => {
    const row = quickEditRow({
      itemHighlight: "H".repeat(109),
      productDescription: "P".repeat(1_799),
      issues: [
        {
          kind: "HIGHLIGHT_BELOW_TARGET",
          field: "itemHighlight",
          message: "產品亮點不足。",
          actualLength: 109,
          minLength: 110,
        },
        {
          kind: "DESCRIPTION_BELOW_TARGET",
          field: "productDescription",
          message: "產品敘述不足。",
          actualLength: 1_799,
          minLength: 1_800,
        },
      ],
    });

    const focus = quickEditFocusForRow(row);
    expect(focus).toMatchObject({
      fields: ["itemHighlight", "productDescription"],
      bulletIndices: [],
    });
    expect(quickEditAvailabilityForRow(row)).toMatchObject({ status: "ready" });
    expect(resolveContentAuditQuickEditFocus(
      focus!,
      freshListing({
        itemHighlight: "H".repeat(109),
        productDescription: "P".repeat(1_799),
      }),
    )).toMatchObject({
      status: "focused",
      focus: {
        fields: ["itemHighlight", "productDescription"],
        bulletIndices: [],
      },
    });
    expect(resolveContentAuditQuickEditFocus(
      focus!,
      freshListing({
        itemHighlight: "H".repeat(110),
        productDescription: "P".repeat(1_799),
      }),
    )).toMatchObject({ status: "stale" });
  });

  it("safely focuses highlight and description typos using exact fresh Amazon text", () => {
    const itemHighlight = "Freshh turkey tendon treats";
    const productDescription = "Nutritous rewards for everyday treating.";
    const focus = quickEditFocusForRow(quickEditRow({
      itemHighlight,
      productDescription,
      issues: [
        {
          kind: "SUSPECTED_TYPO",
          field: "itemHighlight",
          token: "Freshh",
          suggestion: "Fresh",
          message: "產品亮點疑似錯字。",
        },
        {
          kind: "SUSPECTED_TYPO",
          field: "productDescription",
          token: "Nutritous",
          suggestion: "Nutritious",
          message: "產品敘述疑似錯字。",
        },
      ],
    }));

    expect(focus).toMatchObject({
      fields: ["itemHighlight", "productDescription"],
      bulletIndices: [],
    });
    expect(resolveContentAuditQuickEditFocus(
      focus!,
      freshListing({ itemHighlight, productDescription }),
    )).toMatchObject({
      status: "focused",
      focus: {
        fields: ["itemHighlight", "productDescription"],
        reasons: [
          expect.objectContaining({ field: "itemHighlight" }),
          expect.objectContaining({ field: "productDescription" }),
        ],
      },
    });
    expect(resolveContentAuditQuickEditFocus(
      focus!,
      freshListing({
        itemHighlight,
        productDescription: `Updated ${productDescription}`,
      }),
    )).toMatchObject({ status: "stale" });
  });

  it("keeps a mixed highlight length-and-typo row immediately editable", () => {
    const itemHighlight = `Freshh ${"H".repeat(102)}`;
    const focus = quickEditFocusForRow(quickEditRow({
      itemHighlight,
      issues: [
        {
          kind: "HIGHLIGHT_BELOW_TARGET",
          field: "itemHighlight",
          message: "產品亮點目前 109 個字元，低於 110 個字元。",
          actualLength: 109,
          minLength: 110,
        },
        {
          kind: "SUSPECTED_TYPO",
          field: "itemHighlight",
          token: "Freshh",
          suggestion: "Fresh",
          message: "產品亮點疑似錯字。",
        },
      ],
    }));

    expect(focus).toMatchObject({ fields: ["itemHighlight"] });
    expect(resolveContentAuditQuickEditFocus(
      focus!,
      freshListing({ itemHighlight }),
    )).toMatchObject({
      status: "focused",
      focus: {
        fields: ["itemHighlight"],
        reasons: [
          expect.objectContaining({ message: expect.stringContaining("109 個字元") }),
          expect.objectContaining({ message: "產品亮點疑似錯字。" }),
        ],
      },
    });
  });

  it("parses and explains every length reason with per-bullet evidence", () => {
    const title = "T".repeat(59);
    const itemHighlight = "H".repeat(109);
    const bulletPoints = [
      "A".repeat(149),
      "B".repeat(201),
      "C".repeat(150),
      "D".repeat(150),
      "E".repeat(150),
    ];
    const productDescription = "P".repeat(1_799);
    const snapshot = parseContentAuditSnapshot({
      marketplaceId: "ATVPDKIKX0DER",
      fetchedAt: "2026-08-06T08:00:00.000Z",
      rows: [{
        sellerSku: "LENGTHS",
        asin: "B000000999",
        productType: "PET_FOOD",
        title,
        itemHighlight,
        bulletPoints,
        productDescription,
        ingredients: "Turkey",
        readStatus: "complete",
        readErrors: [],
        issues: [
          {
            kind: "TITLE_BELOW_TARGET",
            field: "title",
            message: "產品名稱目前 59 個字元，低於 60 個字元。",
            actualLength: 59,
            minLength: 60,
          },
          {
            kind: "HIGHLIGHT_BELOW_TARGET",
            field: "itemHighlight",
            message: "產品亮點目前 109 個字元，低於 110 個字元。",
            actualLength: 109,
            minLength: 110,
          },
          {
            kind: "BULLET_BELOW_TARGET",
            field: "bulletPoints",
            message: "產品要點 1 目前 149 個字元，低於 150 個字元。",
            bulletIndex: 0,
            actualLength: 149,
            minLength: 150,
            maxLength: 200,
          },
          {
            kind: "BULLET_ABOVE_TARGET",
            field: "bulletPoints",
            message: "產品要點 2 目前 201 個字元，超過 200 個字元。",
            bulletIndex: 1,
            actualLength: 201,
            minLength: 150,
            maxLength: 200,
          },
          {
            kind: "DESCRIPTION_BELOW_TARGET",
            field: "productDescription",
            message: "產品敘述目前 1799 個字元，低於 1800 個字元。",
            actualLength: 1_799,
            minLength: 1_800,
          },
        ],
      }],
      summary: { total: 1 },
    });

    expect(snapshot.rows[0].issues).toHaveLength(5);
    expect(snapshot.summary).toMatchObject({
      titleBelowTarget: 1,
      highlightBelowTarget: 1,
      bulletBelowTarget: 1,
      bulletAboveTarget: 1,
      descriptionBelowTarget: 1,
    });
    const markup = renderToStaticMarkup(
      <ContentAuditPanel
        marketplaceId="ATVPDKIKX0DER"
        marketplaceShort="US"
        onOpenSku={vi.fn()}
        initialJob={completedContentJob(snapshot)}
        cachedResult={{
          snapshot,
          filter: "all",
          query: "",
          spellcheckNote: null,
        }}
      />,
    );
    expect(occurrenceCount(markup, "產品名稱目前 59 個字元，低於 60 個字元。")).toBe(1);
    expect(occurrenceCount(markup, "產品亮點目前 109 個字元，低於 110 個字元。")).toBe(1);
    expect(occurrenceCount(markup, "產品要點 1 目前 149 個字元，低於 150 個字元。")).toBe(1);
    expect(occurrenceCount(markup, "產品要點 2 目前 201 個字元，超過 200 個字元。")).toBe(1);
    expect(occurrenceCount(markup, "產品敘述目前 1799 個字元，低於 1800 個字元。")).toBe(1);
    expect(markup).toMatch(/class="content-audit-fix-now"(?![^>]*disabled="")[^>]*>/u);
    expect(markup).toContain("目前 201 個字元，超過 200 個字元");
  });

  it("drops a length issue whose metadata does not match the returned content", () => {
    const snapshot = parseContentAuditSnapshot({
      marketplaceId: "ATVPDKIKX0DER",
      fetchedAt: "2026-08-06T08:00:00.000Z",
      rows: [{
        sellerSku: "INVALID-LENGTH",
        title: "T".repeat(59),
        bulletPoints: [],
        readStatus: "complete",
        readErrors: [],
        issues: [{
          kind: "TITLE_BELOW_TARGET",
          field: "title",
          message: "tampered",
          actualLength: 58,
          minLength: 60,
        }],
      }],
      summary: { total: 1 },
    });

    expect(snapshot.rows[0].issues).toEqual([]);
    expect(snapshot.summary.titleBelowTarget).toBe(0);
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
        initialJob={completedContentJob(snapshot)}
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
