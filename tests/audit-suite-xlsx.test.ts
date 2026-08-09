import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  createAuditSuiteWorkbook,
  type AuditSuiteWorkbookInput,
  type ValidatedAuditSuiteSnapshot,
} from "../src/main/amazon/audit-suite-xlsx";
import type { AuditSuiteContext } from "../src/shared/audit-suite";

const CONTEXT: AuditSuiteContext = {
  runId: "suite-run-0001",
  marketplaceId: "ATVPDKIKX0DER",
  accountScope: "a".repeat(64),
  mode: "live",
};

function snapshot<TPayload>(
  payload: TPayload,
  status: "completed" | "partial" = "completed",
  notice = "本次資料範圍已核對。",
): ValidatedAuditSuiteSnapshot<TPayload> {
  return {
    ...CONTEXT,
    status,
    fetchedAt: "2026-08-09T05:00:00.000Z",
    notice,
    payload,
  };
}

function completedInput(): AuditSuiteWorkbookInput {
  return {
    context: CONTEXT,
    marketplaceLabel: "US · Amazon.com",
    generatedAt: "2026-08-09T05:10:00.000Z",
    sections: {
      subscription: snapshot([]),
      inventory: snapshot({ over180Rows: [], estimatedExcessRows: [] }),
      content: snapshot([]),
      image: snapshot([]),
      variation: snapshot([]),
      review: snapshot({ resultRows: [], incompleteRows: [] }),
      advertising: snapshot([]),
    },
  };
}

describe("combined FBA audit suite Excel", () => {
  it("creates fixed sheets and marks partial, failed and missing snapshots without fake zeroes", () => {
    const input: AuditSuiteWorkbookInput = {
      ...completedInput(),
      sections: {
        subscription: snapshot([]),
        inventory: snapshot({
          over180Rows: [{
            sellerSku: "AGED-01",
            title: "Aged inventory",
            asin: "B000000001",
            ageBucket: "181–210 天",
            quantity: null,
            notice: "Amazon 未回傳可核對數量；保持空白。",
          }],
          estimatedExcessRows: [{
            sellerSku: "EXCESS-01",
            title: "Estimated excess",
            asin: "B000000002",
            estimatedExcessQuantity: null,
            daysOfSupply: null,
            recommendedAction: "等待 Amazon 回傳完整欄位",
            notice: "數量未知，未補 0。",
          }],
        }, "partial", "庫齡來源有一列未完成；只列已核對資料。"),
        content: null,
        image: {
          ...CONTEXT,
          status: "failed",
          fetchedAt: null,
          notice: "圖片健檢未完成；沒有建立結果快照。",
          payload: null,
        },
        variation: snapshot([]),
        review: snapshot({
          resultRows: [{
            sellerSku: "REVIEW-01",
            title: "Review product",
            asin: "B000000003",
            topic: "Easy to use",
            sentiment: "正向",
            starRatingImpact: 1.2,
            mentions: null,
            occurrencePercent: null,
            notice: "公開 API 未回傳的數值保持空白。",
          }],
          incompleteRows: [{
            sellerSku: "REVIEW-02",
            title: "Incomplete review product",
            asin: "B000000004",
            code: "TOPICS_NOT_RETURNED",
            message: "Customer Feedback 沒有回傳可核對主題。",
          }],
        }, "partial", "一個非 parent ASIN 未完成。"),
        advertising: snapshot([{
          sellerSku: "ADS-01",
          title: "Advertising product",
          asin: "B000000006",
          finding: "未找到廣告覆蓋",
          evidence: "沒有符合規則的 ENABLED SP 活動",
          notice: "只讀 Amazon Ads campaigns。",
        }]),
      },
    };

    const archive = unzipSync(createAuditSuiteWorkbook(input));
    const workbook = strFromU8(archive["xl/workbook.xml"]);
    const expectedSheets = [
      "總覽", "訂閱異常", "180天以上庫齡", "預估冗餘", "文案問題",
      "圖片問題", "未綁變體", "評論結果", "評論未完成",
      "廣告覆蓋",
    ];
    expectedSheets.forEach((name) => expect(workbook).toContain(`sheet name="${name}"`));
    expect(Object.keys(archive).filter((name) => name.startsWith("xl/worksheets/sheet"))).toHaveLength(10);

    const allXml = Object.entries(archive)
      .filter(([name]) => name.endsWith(".xml"))
      .map(([, bytes]) => strFromU8(bytes))
      .join("\n");
    expect(allXml).toContain("本次合併匯出沒有可核對的文案問題快照");
    expect(allXml).toContain("範圍未完整");
    expect(allXml).toContain("圖片健檢未完成；沒有建立結果快照");
    expect(allXml).toContain("數量未知，未補 0");
    expect(allXml).not.toContain("<v>0</v>");
    expect(allXml).not.toContain("<f>");
    expect(allXml).not.toContain("<f ");
    expect(allXml).not.toContain(CONTEXT.accountScope);
  });

  it("writes formula-like source text as inert inline text and never creates formulas", () => {
    const input = completedInput();
    const workbookInput: AuditSuiteWorkbookInput = {
      ...input,
      sections: {
        ...input.sections,
        content: snapshot([{
          sellerSku: "COPY-01",
          title: "Content product",
          asin: "B000000005",
          problemType: "疑似錯字",
          field: "商品標題",
          originalText: '=HYPERLINK("https://example.invalid","click")',
          description: "只保留原文，不執行公式。",
        }]),
      },
    };
    const archive = unzipSync(createAuditSuiteWorkbook(workbookInput));
    const contentSheet = strFromU8(archive["xl/worksheets/sheet5.xml"]);
    expect(contentSheet).toContain("&apos;=HYPERLINK");
    expect(contentSheet).not.toContain("<f>");
    expect(contentSheet).not.toContain("<f ");
    expect(contentSheet).toContain('<pageSetUpPr fitToPage="1"/>');
    expect(contentSheet).toContain('orientation="landscape"');
    expect(contentSheet).toContain('fitToWidth="1"');
  });

  it("fails closed when any supplied snapshot has the wrong marketplace, account or mode", () => {
    const input = completedInput();
    const subscription = input.sections.subscription!;
    expect(() => createAuditSuiteWorkbook({
      ...input,
      sections: {
        ...input.sections,
        subscription: { ...subscription, marketplaceId: "A2EUQ1WTGCTBG2" },
      },
    })).toThrow(/context 不一致/u);
    expect(() => createAuditSuiteWorkbook({
      ...input,
      sections: {
        ...input.sections,
        subscription: { ...subscription, accountScope: "b".repeat(64) },
      },
    })).toThrow(/context 不一致/u);
    expect(() => createAuditSuiteWorkbook({
      ...input,
      sections: {
        ...input.sections,
        subscription: { ...subscription, mode: "demo" },
      },
    })).toThrow(/context 不一致/u);
  });
});
