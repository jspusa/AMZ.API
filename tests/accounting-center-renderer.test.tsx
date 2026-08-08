import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AccountingCenterPanel from "../src/renderer/src/components/accounting-center-panel";
import {
  LatestAccountingRequest,
  accountingDatesReady,
  accountingStateKind,
  accountingStateLabel,
  buildAccountingPlanRequest,
  parseAccountingAccessPlanReply,
  parseAccountingCapabilitySnapshot,
} from "../src/renderer/src/accounting-center";

function capability(overrides: Record<string, unknown> = {}) {
  return {
    id: "FBA_STORAGE_FEES",
    label: "FBA 每月倉儲費估算",
    artifact: "TAB_DELIMITED_REPORT",
    access: "CREATE_PUBLIC_REPORT",
    roles: ["Pricing", "Amazon Fulfillment"],
    availability: "CONFIGURED_FBA_MARKETPLACES",
    fbaSafety: "OFFICIAL_FBA_ONLY",
    reportType: "GET_FBA_STORAGE_FEE_CHARGES_DATA",
    officialSource: "https://developer-docs.amazon.com/sp-api/docs/report-type-values-fba",
    notice: "可請求或排程；內容是估算，不是發票。",
    state: "READY_CREATE_REPORT",
    ...overrides,
  };
}

function response() {
  return {
    marketplaceId: "ATVPDKIKX0DER",
    fetchedAt: "2026-08-08T08:00:00.000Z",
    capabilities: [
      capability(),
      capability({
        id: "FINANCIAL_HOLDS",
        label: "日期區間財務保留款",
        access: "SELLER_CENTRAL_PREREQUISITE",
        roles: ["Finance and Accounting"],
        fbaSafety: "ACCOUNT_WIDE_NOT_FBA_SAFE",
        reportType: "GET_DATE_RANGE_FINANCIAL_HOLDS_DATA",
        state: "MANUAL_PREREQUISITE",
      }),
      capability({
        id: "GENERIC_MARKETPLACE_INVOICES",
        label: "一般站點 Amazon 發票",
        artifact: "NONE",
        access: "UNAVAILABLE_PUBLIC_API",
        roles: [],
        availability: "NONE",
        fbaSafety: "NO_PUBLIC_DATA",
        reportType: null,
        officialSource: "https://developer-docs.amazon.com/sp-api/docs/invoices-api",
        state: "UNAVAILABLE",
      }),
    ],
    notice: "只整理 Amazon 公開 API，不使用 Seller Central 私有接口。",
  };
}

describe("FBA accounting center renderer", () => {
  it("separates public reports, manual prerequisites and unavailable invoices", () => {
    const snapshot = parseAccountingCapabilitySnapshot(response());
    expect(snapshot.capabilities.map(({ state }) => accountingStateKind(state))).toEqual([
      "ready",
      "manual",
      "blocked",
    ]);
    expect(accountingStateLabel(snapshot.capabilities[0].state)).toContain("可建立 FBA 報表");
    expect(accountingStateLabel(snapshot.capabilities[2].state)).toBe("公開 API 不可用");
  });

  it("rejects non-official source URLs, duplicate capabilities and unknown states", () => {
    const privateUrl = response();
    privateUrl.capabilities[0].officialSource = "https://sellercentral.amazon.com/private";
    expect(() => parseAccountingCapabilitySnapshot(privateUrl)).toThrow(/不是允許的 Amazon 開發者文件/u);

    const duplicate = response();
    duplicate.capabilities.push({ ...duplicate.capabilities[0] });
    expect(() => parseAccountingCapabilitySnapshot(duplicate)).toThrow(/重複能力/u);

    const unknownState = response();
    unknownState.capabilities[0].state = "DOWNLOAD_INVOICE_NOW";
    expect(() => parseAccountingCapabilitySnapshot(unknownState)).toThrow(/不在允許清單/u);
  });

  it("parses only a planning result and never requires an upstream private request", () => {
    expect(parseAccountingAccessPlanReply({
      capabilityId: "FBA_REIMBURSEMENTS",
      marketplaceId: "ATVPDKIKX0DER",
      state: "READY_CREATE_REPORT",
      notice: "公開 Reports API 可建立這份 FBA report。",
      nextStep: "確認日期後由主程序建立並綁定 report ID。",
    })).toMatchObject({
      capabilityId: "FBA_REIMBURSEMENTS",
      state: "READY_CREATE_REPORT",
    });
  });

  it("renders honest invoice and bill boundaries before the catalog loads", () => {
    const markup = renderToStaticMarkup(createElement(AccountingCenterPanel, {
      marketplaceId: "ATVPDKIKX0DER",
    }));
    expect(markup).toContain("FBA 帳務中心");
    expect(markup).toContain("一般 Amazon 發票／賣家帳單沒有公開下載 API");
    expect(markup).toContain("只涵蓋巴西 FBA 發票");
    expect(markup).toContain("固定使用送出當下 NOW");
    expect(markup).not.toContain("下載發票");
  });

  it("submits only a start date for fee preview so main can pin the end to NOW", () => {
    expect(accountingDatesReady({
      capabilityId: "FBA_FEE_PREVIEW",
      startDate: "2026-08-01",
      endDate: "",
    })).toBe(true);
    expect(buildAccountingPlanRequest({
      capabilityId: "FBA_FEE_PREVIEW",
      marketplaceId: "ATVPDKIKX0DER",
      startDate: "2026-08-01",
      endDate: "2026-08-02",
    })).toEqual({
      capabilityId: "FBA_FEE_PREVIEW",
      marketplaceId: "ATVPDKIKX0DER",
      dataStartTime: "2026-08-01T00:00:00.000Z",
    });
    expect(accountingDatesReady({
      capabilityId: "FBA_LONG_TERM_STORAGE_FEES",
      startDate: "2026-08-01",
      endDate: "",
    })).toBe(false);
  });

  it("prevents an aborted or stale plan response from winning a date or marketplace race", async () => {
    const requests = new LatestAccountingRequest();
    const applied: string[] = [];
    let resolveFirst: () => void = () => {};
    let resolveSecond: () => void = () => {};
    const firstResponse = new Promise<void>((resolve) => { resolveFirst = resolve; });
    const secondResponse = new Promise<void>((resolve) => { resolveSecond = resolve; });
    const first = requests.begin();
    const applyWhenCurrent = async (
      ticket: ReturnType<LatestAccountingRequest["begin"]>,
      response: Promise<void>,
      value: string,
    ) => {
      await response;
      if (requests.isCurrent(ticket)) applied.push(value);
    };
    const firstApply = applyWhenCurrent(first, firstResponse, "stale");
    const second = requests.begin();
    const secondApply = applyWhenCurrent(second, secondResponse, "current");
    expect(first.controller.signal.aborted).toBe(true);
    resolveSecond();
    await secondApply;
    resolveFirst();
    await firstApply;
    expect(applied).toEqual(["current"]);

    requests.invalidate();
    expect(second.controller.signal.aborted).toBe(true);
    expect(requests.isCurrent(second)).toBe(false);
  });
});
