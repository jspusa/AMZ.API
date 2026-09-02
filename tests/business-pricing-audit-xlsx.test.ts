import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { createBusinessPricingAuditWorkbook } from
  "../src/main/amazon/business-pricing-audit-xlsx";
import type { BusinessPricingAuditSnapshot } from
  "../src/main/amazon/catalog-report-reads";

function snapshot(): BusinessPricingAuditSnapshot {
  return {
    mode: "live",
    marketplaceId: "ATVPDKIKX0DER",
    fetchedAt: "2026-08-23T10:00:00.000Z",
    rows: [{
      sellerSku: "BOTH-MISMATCH",
      asin: "B000000001",
      title: "Price and tier mismatch",
      productType: "PET_FOOD",
      standardPrice: { amount: 20, currencyCode: "USD" },
      businessPrice: { amount: 17.5, currencyCode: "USD" },
      businessOfferPresence: "present",
      quantityDiscountPlan: null,
      quantityDiscountPlanPresence: "absent",
      recommendedPriceMismatch: true,
      recommendedQuantityDiscountMismatch: true,
      status: "configured",
      editable: false,
      reason: "已設定，但不符合兩項 Jasper 建議規則。",
    }, {
      sellerSku: "EXACT-GOOD",
      asin: "B000000002",
      title: "Exact recommendation",
      productType: "PET_FOOD",
      standardPrice: { amount: 20, currencyCode: "USD" },
      businessPrice: { amount: 19, currencyCode: "USD" },
      businessOfferPresence: "present",
      quantityDiscountPlan: {
        discountType: "percent",
        levels: [
          { lowerBound: 5, value: 5 },
          { lowerBound: 10, value: 10 },
          { lowerBound: 15, value: 15 },
          { lowerBound: 20, value: 20 },
        ],
      },
      quantityDiscountPlanPresence: "canonical",
      recommendedPriceMismatch: false,
      recommendedQuantityDiscountMismatch: false,
      status: "configured",
      editable: false,
      reason: "符合兩項建議。",
    }, {
      sellerSku: "MISSING-B2B",
      asin: "B000000003",
      title: "Missing B2B",
      productType: "PET_FOOD",
      standardPrice: { amount: 18, currencyCode: "USD" },
      businessPrice: null,
      businessOfferPresence: "absent",
      quantityDiscountPlan: null,
      quantityDiscountPlanPresence: "absent",
      recommendedPriceMismatch: false,
      recommendedQuantityDiscountMismatch: true,
      status: "missing",
      editable: false,
      reason: "尚未設定 B2B 價格與階梯折扣。",
    }, {
      sellerSku: "CONFIGURED-UNKNOWN",
      asin: "B000000005",
      title: "Configured with unknown recommendation evidence",
      productType: "PET_FOOD",
      standardPrice: null,
      businessPrice: { amount: 9.99, currencyCode: "USD" },
      businessOfferPresence: "present",
      quantityDiscountPlan: null,
      quantityDiscountPlanPresence: "ambiguous",
      recommendedPriceMismatch: false,
      recommendedQuantityDiscountMismatch: false,
      status: "configured",
      editable: false,
      reason: "Business Price 已確認，但一般售價與數量折扣仍待核對。",
    }, {
      sellerSku: "UNKNOWN-EVIDENCE",
      asin: "B000000004",
      title: "Unknown evidence",
      productType: "PET_FOOD",
      standardPrice: null,
      businessPrice: null,
      businessOfferPresence: "ambiguous",
      quantityDiscountPlan: null,
      quantityDiscountPlanPresence: "ambiguous",
      recommendedPriceMismatch: false,
      recommendedQuantityDiscountMismatch: false,
      status: "incomplete",
      editable: false,
      reason: "Amazon 未能確認 Business Price 與階梯折扣。",
    }],
    summary: {
      totalFbaSkuCount: 5,
      configured: 3,
      aboveStandard: 0,
      missing: 1,
      unsupported: 0,
      incomplete: 1,
      recommendedPriceMismatch: 1,
      recommendedQuantityDiscountMismatch: 2,
    },
    notice: "FBA-only fixture.",
  };
}

describe("B2B pricing audit Excel", () => {
  it("creates overlapping recommendation worksheets from the main-owned snapshot", () => {
    const archive = unzipSync(createBusinessPricingAuditWorkbook({
      marketplaceLabel: "US · Amazon.com",
      snapshot: snapshot(),
    }));
    const workbook = strFromU8(archive["xl/workbook.xml"]!);
    expect(workbook).toContain('name="總覽"');
    expect(workbook).toContain('name="全部 B2B"');
    expect(workbook).toContain('name="不符建議 B2B 價格"');
    expect(workbook).toContain('name="未正確設定階梯折扣"');
    expect(workbook).toContain('name="資料未完成"');

    const allRows = strFromU8(archive["xl/worksheets/sheet2.xml"]!);
    const priceRows = strFromU8(archive["xl/worksheets/sheet3.xml"]!);
    const tierRows = strFromU8(archive["xl/worksheets/sheet4.xml"]!);
    const incompleteRows = strFromU8(archive["xl/worksheets/sheet5.xml"]!);
    expect(allRows).toContain("BOTH-MISMATCH");
    expect(allRows).toContain("EXACT-GOOD");
    expect(allRows).toContain("符合建議");
    expect(allRows).toContain("無法判定");
    expect(allRows).not.toContain("符合／無法判定");
    expect(allRows).toContain("正確設定");
    expect(allRows).toContain("已設定但需調整");
    expect(allRows).toContain("已設定但待確認");
    expect(priceRows).toContain("BOTH-MISMATCH");
    expect(priceRows).not.toContain("MISSING-B2B");
    expect(tierRows).toContain("BOTH-MISMATCH");
    expect(tierRows).toContain("MISSING-B2B");
    expect(incompleteRows).toContain("UNKNOWN-EVIDENCE");
    expect(Object.values(archive).map((value) => strFromU8(value)).join("\n"))
      .not.toContain("<f>");
  });

  it("rejects tampered recommendation flags or summaries", () => {
    const source = snapshot();
    const tamperedFlag: BusinessPricingAuditSnapshot = {
      ...source,
      rows: source.rows.map((row, index) => index === 0
        ? { ...row, recommendedPriceMismatch: false }
        : row),
    };
    expect(() => createBusinessPricingAuditWorkbook({
      marketplaceLabel: "US · Amazon.com",
      snapshot: tamperedFlag,
    })).toThrow(/建議分類/u);

    const tamperedSummary: BusinessPricingAuditSnapshot = {
      ...source,
      summary: {
        ...source.summary,
        recommendedQuantityDiscountMismatch: 1,
      },
    };
    expect(() => createBusinessPricingAuditWorkbook({
      marketplaceLabel: "US · Amazon.com",
      snapshot: tamperedSummary,
    })).toThrow(/摘要/u);
  });
});
