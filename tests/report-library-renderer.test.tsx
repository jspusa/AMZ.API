import { renderToStaticMarkup } from "react-dom/server";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import ReportLibraryPanel from "../src/renderer/src/components/report-library-panel";
import ReviewAuditPanel from "../src/renderer/src/components/review-audit-panel";
import {
  parseReportAccessPlan,
  parseReportLibrarySnapshot,
} from "../src/renderer/src/report-library";
import { parseReviewAuditJob, parseReviewAuditSnapshot } from "../src/renderer/src/review-audit";

const US = "ATVPDKIKX0DER";

function libraryFixture() {
  return {
    schemaVersion: 1,
    marketplaceId: US,
    fetchedAt: "2026-08-09T00:00:00.000Z",
    officialCatalog: {
      uniqueReportTypeCount: 2,
      verifiedAt: "2026-08-09",
      officialPageUpdatedLabel: "Updated 5 days ago",
      source: "https://developer-docs.amazon.com/sp-api/docs/report-type-values",
      changeNotice: "Amazon 官方清單可能隨時更新。",
    },
    currentAppExports: [{
      id: "REVIEW_TOPIC_AUDIT_XLSX",
      label: "FBA 非 parent ASIN 評論主題健檢 Excel",
      source: "Customer Feedback API",
      scope: "僅主題，不含完整 review 全文。",
      availability: "AVAILABLE_AFTER_SUCCESSFUL_AUDIT",
    }],
    reports: [{
      reportType: "GET_AFN_INVENTORY_DATA",
      label: "AFN 庫存",
      description: "FBA 庫存摘要。",
      categories: ["FBA"],
      party: "SELLER",
      fbaScope: "FBA_ONLY",
      lifecycle: "REQUEST",
      output: "TAB_DELIMITED",
      restrictedData: "NONE",
      roles: ["Amazon Fulfillment"],
      marketplaceAvailability: "FBA sellers",
      prerequisites: [],
      deprecated: false,
      officialSource: "https://developer-docs.amazon.com/sp-api/docs/report-type-values-fba",
      state: "READY_TO_PLAN",
      amazonPublicArtifactAvailable: true,
      appDownloadImplemented: false,
      stateNotice: "Amazon 有此文件，App 尚未接線。",
    }, {
      reportType: "GET_VENDOR_INVENTORY_REPORT",
      label: "Vendor 庫存",
      description: "僅 Vendor Central。",
      categories: ["INVENTORY"],
      party: "VENDOR",
      fbaScope: "OUT_OF_FBA_SCOPE",
      lifecycle: "REQUEST",
      output: "TAB_DELIMITED",
      restrictedData: "NONE",
      roles: ["Vendor"],
      marketplaceAvailability: "Vendor only",
      prerequisites: ["Vendor role"],
      deprecated: false,
      officialSource: "https://developer-docs.amazon.com/sp-api/docs/report-type-values",
      state: "EXTRA_ROLE_REQUIRED",
      amazonPublicArtifactAvailable: true,
      appDownloadImplemented: false,
      stateNotice: "需要 Vendor Central。",
    }],
    unavailableDocuments: [{
      id: "PRODUCT_REVIEW_TEXT",
      label: "完整 review 全文",
      reason: "公開 API 不提供。",
      officialSource: "https://developer-docs.amazon.com/sp-api/docs/get-feedback-insights-asin",
    }],
    reviewAuditCapability: {
      supportedForMarketplace: true,
      roles: ["Selling Partner Insights", "Brand Analytics"],
      updateCadence: "WEEKLY",
      topicLanguage: "ENGLISH_ONLY",
      nonParentFbaAsinsOnly: true,
      relationshipsEvidenceRequired: true,
      parentContainersExcluded: true,
      fullReviewTextAvailable: false,
      averageProductRatingAvailable: false,
      totalReviewCountAvailable: false,
    },
    notice: "FBA-only · public API only",
  };
}

describe("report library renderer contracts", () => {
  it("keeps current exports separate and rejects a falsely wired generic download", () => {
    const parsed = parseReportLibrarySnapshot(libraryFixture());
    expect(parsed.currentAppExports).toMatchObject([{ id: "REVIEW_TOPIC_AUDIT_XLSX" }]);
    expect(parsed.reports.find(({ reportType }) => reportType === "GET_AFN_INVENTORY_DATA"))
      .toMatchObject({ reportType: "GET_AFN_INVENTORY_DATA", appDownloadImplemented: false });
    const unsafe = libraryFixture();
    unsafe.reports[0].appDownloadImplemented = true as false;
    expect(() => parseReportLibrarySnapshot(unsafe)).toThrow(/App 已接線/u);
  });

  it("renders the library as a standalone panel for Dashboard integration", () => {
    const html = renderToStaticMarkup(<ReportLibraryPanel marketplaceId={US} />);
    expect(html).toContain("文件庫");
    expect(html).toContain("PUBLIC API");
    expect(html).toContain("正在整理 Amazon 公開文件能力");
  });

  it("keeps Vendor-only reports hidden and exposes the access-state filter", async () => {
    const source = await readFile(
      new URL("../src/renderer/src/components/report-library-panel.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain('report.party !== "VENDOR"');
    expect(source).toContain("需額外角色／資格");
    expect(source).toContain("目前站點不支援");
    expect(source).toContain("目前站點可規劃");
    expect(source).toContain('item.id !== "REVIEW_TOPIC_AUDIT_XLSX"');
  });

  it("rejects a stale access plan from another marketplace", () => {
    const plan = {
      reportType: "GET_AFN_INVENTORY_DATA",
      marketplaceId: "A1VC38T7YXB528",
      state: "READY_TO_PLAN",
      amazonPublicArtifactAvailable: true,
      appDownloadImplemented: false,
      notice: "Amazon 有此文件，App 尚未接線。",
      nextStep: "Implement parser.",
    };
    expect(() => parseReportAccessPlan(
      plan,
      US,
      "GET_AFN_INVENTORY_DATA",
    )).toThrow(/站點/u);
  });
});

describe("review audit renderer contracts", () => {
  it("parses progress and a fail-honest completed snapshot", () => {
    expect(parseReviewAuditJob({
      jobId: "job-12345678",
      marketplaceId: US,
      mode: "live",
      ready: false,
      status: "READING_NON_PARENT_TOPICS",
      progress: { completed: 1, total: 10, percent: 10 },
      message: "正在讀取非 parent ASIN 主題。",
      capabilityNotice: "僅英文；評論主題影響值。",
    }, US)).toMatchObject({ progress: { completed: 1, total: 10 } });

    const snapshot = parseReviewAuditSnapshot({
      schemaVersion: 2,
      mode: "live",
      marketplaceId: US,
      fetchedAt: "2026-08-09T00:00:00.000Z",
      exportId: "export-12345678",
      rows: [{
        sellerSkus: ["AFA12AM"], asin: "B000000001", title: "Turkey tendon",
        relationshipRole: "child",
        status: "COMPLETE",
        positiveTopics: [{ topic: "Taste", numberOfMentions: 10, occurrencePercentage: 20, starRatingImpact: 4.5, reviewSnippets: ["Great"] }],
        negativeTopics: [{ topic: "Smell", numberOfMentions: 2, occurrencePercentage: 4, starRatingImpact: -1.2, reviewSnippets: ["Strong"] }],
        incompleteReason: null,
        averageProductRating: null,
        totalReviewCount: null,
        fullReviewTextAvailable: false,
      }],
      relationshipIncompleteRows: [],
      topFivePositive: [{ sellerSkus: ["AFA12AM"], asin: "B000000001", title: "Turkey tendon", topic: "Taste", numberOfMentions: 10, occurrencePercentage: 20, starRatingImpact: 4.5, metricLabel: "NON_PARENT_ASIN_TOPIC_STAR_RATING_IMPACT" }],
      bottomFiveNegative: [{ sellerSkus: ["AFA12AM"], asin: "B000000001", title: "Turkey tendon", topic: "Smell", numberOfMentions: 2, occurrencePercentage: 4, starRatingImpact: -1.2, metricLabel: "NON_PARENT_ASIN_TOPIC_STAR_RATING_IMPACT" }],
      summary: {
        sourceFbaListings: 1,
        verifiedNonParentListings: 1,
        uniqueFbaNonParentAsins: 1,
        verifiedChildListings: 1,
        verifiedStandaloneListings: 0,
        excludedParentContainers: 0,
        relationshipIncomplete: 0,
        completed: 1,
        noTopics: 0,
        feedbackIncomplete: 0,
        totalIncomplete: 0,
        incomplete: 0,
        duplicateSkuAsinsCollapsed: 0,
      },
      notice: "這是評論主題影響值；負數不是商品負星等。",
    }, US);
    expect(snapshot).toMatchObject({
      rows: [{ averageProductRating: null, totalReviewCount: null, fullReviewTextAvailable: false }],
      topFivePositive: [{ metricLabel: "NON_PARENT_ASIN_TOPIC_STAR_RATING_IMPACT" }],
    });
    const html = renderToStaticMarkup(
      <ReviewAuditPanel
        marketplaceId={US}
        marketplaceShort="US"
        cachedResult={{ snapshot, job: null }}
      />,
    );
    expect(html).toContain("前五：正向主題影響值");
    expect(html).toContain("後五：負向主題影響值");
    expect(html).toContain("正向影響值 4.5");
    expect(html).toContain("負向影響值 −1.2");
    expect(html).toContain("負數是此負向主題對星等下降方向的影響值");
    expect(html).toContain("不是商品出現「負的星星」");
    expect(html).toContain("不轉成 0、不裁切，也不改成絕對值");
  });

  it("renders explicit API boundaries and disables unsupported stores", () => {
    const html = renderToStaticMarkup(<ReviewAuditPanel marketplaceId="A2EUQ1WTGCTBG2" marketplaceShort="CA" />);
    expect(html).toContain("影響值不是商品星等，也不是 1–5 星制");
    expect(html).toContain("不提供完整 review 全文");
    expect(html).toContain("US、JP、UK 與 DE");
    expect(html).toContain("disabled");
  });

  it("labels an unfinished main-owned job as viewable rather than needing a resume click", () => {
    const job = parseReviewAuditJob({
      jobId: "job-resume-1234",
      marketplaceId: US,
      mode: "live",
      ready: false,
      status: "READING_NON_PARENT_TOPICS",
      progress: { completed: 37, total: 100, percent: 37 },
      message: "正在讀取非 parent ASIN 主題。",
      capabilityNotice: "僅英文；評論主題影響值。",
    }, US);
    const html = renderToStaticMarkup(
      <ReviewAuditPanel
        marketplaceId={US}
        marketplaceShort="US"
        cachedResult={{ snapshot: null, job }}
      />,
    );
    expect(html).toContain("查看進行中的評論健檢");
    expect(html).toContain("Mac main process 仍會在背景繼續");
    expect(html).toContain("不必回來按按鈕");
    expect(html).toContain("value=\"37\"");
    expect(html).not.toContain("重新掃描全站評論主題");
  });

  it("does not abort polling when the parent echoes the panel cache update", async () => {
    const source = await readFile(
      new URL("../src/renderer/src/components/review-audit-panel.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("const cachedResultRef = useRef(cachedResult)");
    expect(source).toContain("cachedResultRef.current = cachedResult");
    expect(source).toContain("const autoObservedJobRef = useRef<string | null>(null)");
    expect(source).toContain("useEffect(() => () => abortRef.current?.abort(), [])");
    expect(source).toContain("renderer unmount only stops local polling");
    expect(source).not.toContain("/api/sp-api/review-audit/cancel");
    expect(source).toContain("}, [marketplaceId]);");
    expect(source).not.toContain("}, [cachedResult, marketplaceId]);");
  });
});
