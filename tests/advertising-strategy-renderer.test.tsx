import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseAdvertisingStrategySnapshot } from "../src/renderer/src/advertising-strategy";
import AdsDrawer from "../src/renderer/src/components/ads-drawer";
import AdvertisingStrategyPanel, {
  AdvertisingStrategySnapshotView,
  clearRememberedAdvertisingStrategyJob,
  defaultAdvertisingStrategyDateRange,
  kickoffAdvertisingStrategyJob,
  parseAdvertisingStrategyJob,
  pollAdvertisingStrategyJob,
  readRememberedAdvertisingStrategyJob,
  rememberAdvertisingStrategyJob,
  resumeAdvertisingStrategyJob,
  shouldClearAdvertisingStrategyJobPointer,
  startAdvertisingStrategyJob,
  validateAdvertisingStrategyDateRange,
} from "../src/renderer/src/components/advertising-strategy-panel";

const US = "ATVPDKIKX0DER";
const CA = "A2EUQ1WTGCTBG2";
const RANGE = { startDate: "2026-07-21", endDate: "2026-08-19" } as const;

function manualFields() {
  return {
    specification: null,
    sbSales: null,
    sbSalesAcos: null,
    sbAttack: null,
    sbAttackAcos: null,
    sdAttack: null,
    sdAttackAcos: null,
    sdDefense: null,
    sdDefenseAcos: null,
    sdRemarketing: null,
    sdRemarketingAcos: null,
    otherAdvertising: null,
  };
}

function strategySnapshotFixture() {
  return {
    schemaVersion: 1,
    marketplaceId: US,
    marketplaceCode: "US",
    dateRange: RANGE,
    currencyCode: "USD",
    fetchedAt: "2026-08-20T08:00:00.000Z",
    sourceFetchedAt: {
      fba: "2026-08-20T07:57:00.000Z",
      sales: "2026-08-20T07:58:00.000Z",
      ads: "2026-08-20T07:59:00.000Z",
    },
    rows: [
      {
        sellerSku: "DEMO-SKU-01",
        asin: "B000000001",
        title: "Synthetic FBA product",
        price: null,
        salesStatus: "reported",
        unitsSold: 10,
        salesAmount: 100,
        salesRank: 1,
        salesTier: "T1",
        suggestedSpDailyBudget: 300,
        suggestedSpTargetAcos: 0.35,
        suggestion: "overrideable-default",
        spStatus: "reported",
        spSpend: 20,
        spSpendRank: 1,
        spAttribution: "seller-sku",
        spSales14d: 80,
        spActualAcos: 0.25,
        spActualAcosStatus: "reported",
        spPurchases14d: 3,
        ...manualFields(),
      },
      {
        sellerSku: "DEMO-SKU-02",
        asin: "B000000002",
        title: "Synthetic product with zero attributed sales",
        price: null,
        salesStatus: "not-reported",
        unitsSold: null,
        salesAmount: null,
        salesRank: null,
        salesTier: null,
        suggestedSpDailyBudget: null,
        suggestedSpTargetAcos: null,
        suggestion: null,
        spStatus: "reported",
        spSpend: 0,
        spSpendRank: 2,
        spAttribution: "unique-asin",
        spSales14d: 0,
        spActualAcos: null,
        spActualAcosStatus: "no-sales",
        spPurchases14d: 0,
        ...manualFields(),
      },
      {
        sellerSku: "DEMO-SKU-03",
        asin: "B000000003",
        title: "Synthetic product without reports",
        price: null,
        salesStatus: "not-reported",
        unitsSold: null,
        salesAmount: null,
        salesRank: null,
        salesTier: null,
        suggestedSpDailyBudget: null,
        suggestedSpTargetAcos: null,
        suggestion: null,
        spStatus: "not-reported",
        spSpend: null,
        spSpendRank: null,
        spAttribution: null,
        spSales14d: null,
        spActualAcos: null,
        spActualAcosStatus: null,
        spPurchases14d: null,
        ...manualFields(),
      },
    ],
    unresolved: [],
    coverage: {
      currentFbaSkuCount: 3,
      salesSourceRowCount: 1,
      salesResolvedSourceRowCount: 1,
      salesUnresolvedSourceRowCount: 0,
      salesAnonymousUnprovenSourceRowCount: 0,
      salesReportedSkuCount: 1,
      salesNotReportedSkuCount: 2,
      spSourceRowCount: 2,
      spResolvedSourceRowCount: 2,
      spUnresolvedSourceRowCount: 0,
      spAnonymousUnprovenSourceRowCount: 0,
      spReportedSkuCount: 2,
      spNotReportedSkuCount: 1,
      spDirectSourceRowCount: 1,
      spUniqueAsinSourceRowCount: 1,
    },
    summary: {
      tierCounts: { T1: 1, T2: 0, T3: 0, T4: 0 },
      reportedUnitsSold: 10,
      unresolvedUnitsSold: 0,
      sourceUnitsSold: 10,
      reportedSalesAmount: 100,
      unresolvedSalesAmount: 0,
      sourceSalesAmount: 100,
      reportedSpSpend: 20,
      unresolvedSpSpend: 0,
      sourceSpSpend: 20,
      suggestedSpDailyBudget: 300,
    },
    rule: {
      salesTierMethod: "reported-sales-desc-sku-asc-ceil-20-50-80",
      adsAttributionMethod: "exact-sku-or-unique-current-fba-asin",
      missingReportMethod: "null-not-reported-never-zero",
      unprovenSourceMethod: "anonymous-count-only-no-identifiers-or-metrics",
      suggestionIsOverrideable: true,
      presets: {
        T1: { dailyBudget: 300, targetAcos: 0.35 },
        T2: { dailyBudget: 100, targetAcos: 0.30 },
        T3: { dailyBudget: 50, targetAcos: 0.30 },
        T4: { dailyBudget: 50, targetAcos: 0.50 },
      },
      manualFields: [
        "specification",
        "sbSales",
        "sbSalesAcos",
        "sbAttack",
        "sbAttackAcos",
        "sdAttack",
        "sdAttackAcos",
        "sdDefense",
        "sdDefenseAcos",
        "sdRemarketing",
        "sdRemarketingAcos",
        "otherAdvertising",
      ],
    },
    notice: "Synthetic read-only strategy snapshot.",
  };
}

function runningJob(input: {
  marketplaceId?: string;
  marketplaceCode?: string;
  jobId?: string;
  dateRange?: typeof RANGE;
} = {}) {
  return {
    schemaVersion: 1,
    jobId: input.jobId ?? "ads-strategy-job-1",
    marketplaceId: input.marketplaceId ?? US,
    marketplaceCode: input.marketplaceCode ?? "US",
    dateRange: input.dateRange ?? RANGE,
    state: "running",
    progress: { phase: "sales", completed: 1, total: 4 },
    notice: "正在整理 synthetic data。",
    snapshot: null,
  };
}

function failedJob(jobId = "ads-strategy-job-1") {
  return {
    ...runningJob({ jobId }),
    state: "failed",
    progress: { phase: "ads", completed: 2, total: 4 },
    notice: "Synthetic job stopped safely。",
    errorCode: "ADS_READ_FAILED",
  };
}

function completedJob() {
  return {
    ...runningJob(),
    state: "completed",
    progress: { phase: "building", completed: 4, total: 4 },
    notice: "Synthetic strategy completed。",
    snapshot: strategySnapshotFixture(),
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("advertising strategy renderer", () => {
  beforeEach(() => clearRememberedAdvertisingStrategyJob());

  it("uses the marketplace timezone for the latest 30 complete days and rejects unsafe ranges", () => {
    const now = new Date("2026-08-21T02:00:00.000Z");
    expect(defaultAdvertisingStrategyDateRange({
      timeZone: "America/Los_Angeles",
      now,
    })).toEqual(RANGE);
    expect(defaultAdvertisingStrategyDateRange({
      timeZone: "Asia/Tokyo",
      now,
    })).toEqual({ startDate: "2026-07-22", endDate: "2026-08-20" });

    expect(validateAdvertisingStrategyDateRange(
      { startDate: "2026-07-20", endDate: "2026-08-19" },
      { timeZone: "America/Los_Angeles", now },
    )).toEqual({ startDate: "2026-07-20", endDate: "2026-08-19" });
    expect(() => validateAdvertisingStrategyDateRange(
      { startDate: "2026-07-19", endDate: "2026-08-19" },
      { timeZone: "America/Los_Angeles", now },
    )).toThrow(/1 到 31/u);
    expect(() => validateAdvertisingStrategyDateRange(
      { startDate: "2026-07-21", endDate: "2026-08-20" },
      { timeZone: "America/Los_Angeles", now },
    )).toThrow(/昨天/u);
  });

  it("strictly fences the job identity and nested envelope fields", () => {
    const expected = {
      marketplaceId: US,
      marketplaceCode: "US",
      dateRange: RANGE,
      currencyCode: "USD",
    };
    expect(parseAdvertisingStrategyJob(runningJob(), expected).jobId).toBe("ads-strategy-job-1");
    expect(parseAdvertisingStrategyJob(completedJob(), expected).snapshot?.rows).toHaveLength(3);
    expect(() => parseAdvertisingStrategyJob({
      ...runningJob(),
      accountScope: "must-never-reach-pages",
    }, expected)).toThrow(/安全辨識/u);
    expect(() => parseAdvertisingStrategyJob({
      ...runningJob(),
      progress: { ...runningJob().progress, accountScope: "hidden" },
    }, expected)).toThrow(/安全辨識/u);
    expect(() => parseAdvertisingStrategyJob(runningJob({ marketplaceId: CA }), expected)).toThrow(/安全辨識/u);
    expect(() => parseAdvertisingStrategyJob({
      ...completedJob(),
      snapshot: { ...strategySnapshotFixture(), marketplaceCode: "CA" },
    }, expected)).toThrow(/站點代碼/u);
  });

  it("keeps only the latest opaque job pointer per marketplace", () => {
    const expected = {
      marketplaceId: US,
      marketplaceCode: "US",
      dateRange: RANGE,
      currencyCode: "USD",
    };
    rememberAdvertisingStrategyJob(parseAdvertisingStrategyJob(runningJob(), expected));
    rememberAdvertisingStrategyJob(parseAdvertisingStrategyJob(
      runningJob({ jobId: "ads-strategy-job-2" }),
      expected,
    ));
    rememberAdvertisingStrategyJob(parseAdvertisingStrategyJob(
      runningJob({ marketplaceId: CA, marketplaceCode: "CA", jobId: "ca-job-1" }),
      { ...expected, marketplaceId: CA, marketplaceCode: "CA", currencyCode: "CAD" },
    ));

    expect(readRememberedAdvertisingStrategyJob(US)?.jobId).toBe("ads-strategy-job-2");
    expect(readRememberedAdvertisingStrategyJob(CA)?.jobId).toBe("ca-job-1");
    expect(readRememberedAdvertisingStrategyJob(US)).not.toHaveProperty("snapshot");
    expect(readRememberedAdvertisingStrategyJob(US)).not.toHaveProperty("accountScope");
  });

  it("starts only from an explicit call and sends retry intent only when requested", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const request = async (url: string, init?: RequestInit) => {
      requests.push({ url, init });
      return jsonResponse(runningJob(), 202);
    };
    await startAdvertisingStrategyJob({
      marketplaceId: US,
      marketplaceCode: "US",
      dateRange: RANGE,
      currencyCode: "USD",
      request,
    });
    await startAdvertisingStrategyJob({
      marketplaceId: US,
      marketplaceCode: "US",
      dateRange: RANGE,
      currencyCode: "USD",
      refresh: true,
      explicitRetry: true,
      request,
    });

    expect(requests).toHaveLength(2);
    expect(requests.every((entry) => entry.url === "/api/amazon-ads/strategy" && entry.init?.method === "POST")).toBe(true);
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      marketplaceId: US,
      startDate: RANGE.startDate,
      endDate: RANGE.endDate,
    });
    expect(JSON.parse(String(requests[1]?.init?.body))).toEqual({
      marketplaceId: US,
      startDate: RANGE.startDate,
      endDate: RANGE.endDate,
      refresh: true,
      explicitRetry: true,
    });
  });

  it("reopens against a pending kickoff without dispatching a second POST", async () => {
    const expected = {
      marketplaceId: US,
      marketplaceCode: "US",
      dateRange: RANGE,
      currencyCode: "USD",
    };
    rememberAdvertisingStrategyJob(parseAdvertisingStrategyJob(
      runningJob({ jobId: "old-completed-job" }),
      expected,
    ));
    let finishRequest: ((response: Response) => void) | null = null;
    const request = () => new Promise<Response>((resolve) => {
      finishRequest = resolve;
    });
    const kickoff = kickoffAdvertisingStrategyJob({
      marketplaceId: US,
      marketplaceCode: "US",
      dateRange: RANGE,
      currencyCode: "USD",
      request,
    });
    expect(readRememberedAdvertisingStrategyJob(US)?.jobId).toBe("old-completed-job");
    const forbiddenSecondPost = vi.fn(async () => jsonResponse(runningJob(), 202));
    expect(kickoffAdvertisingStrategyJob({
      marketplaceId: US,
      marketplaceCode: "US",
      dateRange: RANGE,
      currencyCode: "USD",
      request: forbiddenSecondPost,
    })).toBe(kickoff);

    const resumeRequests: Array<{ url: string; init?: RequestInit }> = [];
    const resumed = resumeAdvertisingStrategyJob({
      marketplaceId: US,
      currencyCode: "USD",
      request: async (url, init) => {
        resumeRequests.push({ url, init });
        return jsonResponse(failedJob("ads-strategy-job-2"));
      },
      wait: async () => undefined,
    });

    finishRequest?.(jsonResponse(runningJob({ jobId: "ads-strategy-job-2" }), 202));
    await kickoff;
    expect((await resumed)?.state).toBe("failed");
    expect(readRememberedAdvertisingStrategyJob(US)?.jobId).toBe("ads-strategy-job-2");
    expect(forbiddenSecondPost).not.toHaveBeenCalled();
    expect(resumeRequests).toHaveLength(1);
    expect(resumeRequests[0]?.init?.method).toBe("GET");
    expect(new URL(resumeRequests[0]!.url, "https://local.invalid").searchParams.get("jobId")).toBe("ads-strategy-job-2");
  });

  it("resumes a remembered job with GET only and never converts polling into a POST", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const responses = [runningJob(), failedJob()];
    const wait = vi.fn(async () => undefined);
    const result = await pollAdvertisingStrategyJob({
      pointer: {
        marketplaceId: US,
        marketplaceCode: "US",
        jobId: "ads-strategy-job-1",
        dateRange: RANGE,
      },
      currencyCode: "USD",
      request: async (url, init) => {
        calls.push({ url, init });
        return jsonResponse(responses.shift());
      },
      wait,
    });

    expect(result.state).toBe("failed");
    expect(wait).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
    expect(calls.every((entry) => entry.init?.method === "GET")).toBe(true);
    const query = new URL(calls[0]!.url, "https://local.invalid").searchParams;
    expect(Object.fromEntries(query)).toEqual({
      marketplaceId: US,
      jobId: "ads-strategy-job-1",
      startDate: RANGE.startDate,
      endDate: RANGE.endDate,
    });
  });

  it("does not blindly retry a report protection response", async () => {
    const request = vi.fn(async () => jsonResponse({
      code: "REPORT_RETRY_REQUIRED",
      message: "需要明確重試。",
    }, 409));
    await expect(startAdvertisingStrategyJob({
      marketplaceId: US,
      marketplaceCode: "US",
      dateRange: RANGE,
      currencyCode: "USD",
      request,
    })).rejects.toMatchObject({
      status: 409,
      code: "REPORT_RETRY_REQUIRED",
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(shouldClearAdvertisingStrategyJobPointer({
      status: 409,
      code: "REPORT_RETRY_REQUIRED",
    })).toBe(false);
    expect(shouldClearAdvertisingStrategyJobPointer({
      status: 429,
      code: "REPORT_RETRY_WAIT",
    })).toBe(false);
    expect(shouldClearAdvertisingStrategyJobPointer({
      status: 404,
      code: null,
    })).toBe(true);
  });

  it("renders overrideable percentage suggestions and manual blank fields honestly", () => {
    const snapshot = parseAdvertisingStrategySnapshot(strategySnapshotFixture(), {
      marketplaceId: US,
      startDate: RANGE.startDate,
      endDate: RANGE.endDate,
      currencyCode: "USD",
    });
    const html = renderToStaticMarkup(
      <AdvertisingStrategySnapshotView snapshot={snapshot} visibleCount={60} />,
    );
    expect(html).toContain("可覆寫建議");
    expect(html).toContain("35%");
    expect(html).toContain("25%");
    expect(html).not.toContain("3500%");
    expect(html).toContain("無歸因銷售");
    expect(html).toContain("FBA 文件 2026-08-20 07:57 UTC");
    expect(html).toContain("價格（不推算）");
    expect(html).toContain("價格不以營業額除以件數推算");
    expect(html).toContain("SB／SD／規格");
    expect(html).toContain("留白");
    expect(html).not.toMatch(/accountScope|refreshToken|clientSecret/u);
  });

  it("shows unproven non-FBA source rows only as anonymous isolation counts", () => {
    const fixture = strategySnapshotFixture();
    fixture.coverage.salesSourceRowCount = 3;
    fixture.coverage.salesUnresolvedSourceRowCount = 2;
    fixture.coverage.salesAnonymousUnprovenSourceRowCount = 2;
    fixture.coverage.spSourceRowCount = 4;
    fixture.coverage.spUnresolvedSourceRowCount = 2;
    fixture.coverage.spAnonymousUnprovenSourceRowCount = 2;
    const snapshot = parseAdvertisingStrategySnapshot(fixture, {
      marketplaceId: US,
      startDate: RANGE.startDate,
      endDate: RANGE.endDate,
      currencyCode: "USD",
    });

    const html = renderToStaticMarkup(
      <AdvertisingStrategySnapshotView snapshot={snapshot} visibleCount={60} />,
    );

    expect(html).toContain("來源隔離／未完成");
    expect(html).toContain("未證明 FBA 的匿名隔離：品項銷售 2 筆、Ads 2 筆");
    expect(html).toContain("匿名列不顯示 SKU／ASIN 或營業數據");
  });

  it("places the strategy panel above coverage and renders disconnected without starting work", () => {
    const panel = renderToStaticMarkup(
      <AdvertisingStrategyPanel
        marketplaceId={US}
        marketplaceCode="US"
        marketplaceTimeZone="America/Los_Angeles"
        currencyCode="USD"
        available={false}
        unavailableNotice="Synthetic Ads connection is unavailable."
      />,
    );
    expect(panel).toContain("FBA 廣告策略建議");
    expect(panel).toContain("disabled");
    expect(panel).toContain("SB／SD／規格刻意留白");
    expect(panel).toContain("Ads Reporting v3 要等首次成功才算驗證");
    expect(panel).toContain("按鈕可用不代表報表權限已通過");

    const drawer = renderToStaticMarkup(
      <AdsDrawer initialMarketplaceId={US} onClose={() => undefined} />,
    );
    expect(drawer.indexOf("FBA 廣告策略建議")).toBeLessThan(
      drawer.indexOf("全站廣告覆蓋健檢"),
    );
  });
});
