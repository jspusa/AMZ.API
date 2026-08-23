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
      content: snapshot([]),
      image: snapshot([]),
      aplus: snapshot([]),
      variation: snapshot([]),
      subscription: snapshot([]),
      businessPricing: snapshot([]),
      advertising: snapshot([]),
    },
  };
}

describe("combined FBA audit suite Excel", () => {
  it("creates fixed sheets and marks partial, failed and missing snapshots without fake zeroes", () => {
    const input: AuditSuiteWorkbookInput = {
      ...completedInput(),
      sections: {
        subscription: snapshot([{
          sellerSku: "SUB-01",
          title: "Subscription product",
          asin: "B000000001",
          anomaly: "折扣資料未完整",
          sellerFundedBaseDiscountPercent: null,
          currentActiveSubscriptions: null,
          currentPrice: null,
          notice: "數量未知，未補 0。",
        }], "partial", "訂閱來源有一列未完成；只列已核對資料。"),
        content: null,
        image: {
          ...CONTEXT,
          status: "failed",
          fetchedAt: null,
          notice: "圖片健檢未完成；沒有建立結果快照。",
          payload: null,
        },
        aplus: snapshot([{
          sellerSku: "APLUS-01",
          title: "A+ product",
          asin: "B000000007",
          finding: "尚未發布 A+",
          notice: "只列官方 API 可證明的發布狀態。",
        }]),
        variation: snapshot([]),
        businessPricing: snapshot([{
          sellerSku: "B2B-01",
          title: "Business product",
          asin: "B000000008",
          standardPrice: 19.99,
          businessPrice: 20.99,
          currencyCode: "USD",
          finding: "B2B 價格高於一般售價",
          editable: true,
          notice: "只讀核對；未執行寫入。",
        }]),
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
      "總覽",
      "全站文案健檢",
      "全站圖片健檢",
      "全站 A+ 健檢",
      "未綁變體健檢",
      "全站訂閱價格健檢",
      "全站 B2B 價格健檢",
      "廣告覆蓋健檢",
    ];
    expectedSheets.forEach((name) => expect(workbook).toContain(`sheet name="${name}"`));
    for (let index = 1; index < expectedSheets.length; index += 1) {
      expect(workbook.indexOf(`sheet name="${expectedSheets[index - 1]}"`)).toBeLessThan(
        workbook.indexOf(`sheet name="${expectedSheets[index]}"`),
      );
    }
    expect(workbook).not.toContain("180天以上庫齡");
    expect(workbook).not.toContain("評論結果");
    expect(Object.keys(archive).filter((name) => name.startsWith("xl/worksheets/sheet"))).toHaveLength(8);

    const allXml = Object.entries(archive)
      .filter(([name]) => name.endsWith(".xml"))
      .map(([, bytes]) => strFromU8(bytes))
      .join("\n");
    expect(allXml).toContain("本次合併匯出沒有可核對的全站文案健檢快照");
    expect(allXml).toContain("範圍未完整");
    expect(allXml).toContain("圖片健檢未完成；沒有建立結果快照");
    expect(allXml).toContain("數量未知，未補 0");
    expect(allXml).toContain("尚未發布 A+");
    expect(allXml).not.toContain("From the brand");
    expect(allXml).not.toContain("Brand Story");
    expect(allXml).toContain("B2B 價格高於一般售價");
    expect(allXml).toContain("只讀核對；未執行寫入。");
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
    const contentSheet = strFromU8(archive["xl/worksheets/sheet2.xml"]);
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
